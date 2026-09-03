import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { addressAllowed, SecurityService } from '../security/security.service';

/** Where a sign-in came from, for the history and the session it opens. */
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    tenantId: string;
  };
  /** Workspace slug - required to sign in again, so callers must surface it. */
  tenantSlug: string;
  tokens: AuthTokens;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly security: SecurityService,
  ) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const baseSlug = this.slugify(dto.organizationName) || 'org';

    // Ensure a unique tenant slug
    let slug = baseSlug;
    let suffix = 1;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const { tenant, user } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.organizationName, slug },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: Role.TENANT_ADMIN,
        },
      });
      return { tenant, user };
    });

    return this.buildAuthResult(user, tenant.slug);
  }

  async login(
    dto: LoginDto,
    context: RequestContext = {},
  ): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });
    if (!tenant || !tenant.isActive) {
      // Recorded without a tenant: somebody guessing workspace names is worth
      // seeing even though there is no workspace to attach it to.
      await this.security.recordAttempt({
        email,
        success: false,
        reason: 'unknown_workspace',
        ...context,
      });
      throw new UnauthorizedException(
        `Workspace "${dto.tenantSlug}" not found - check your workspace slug`,
      );
    }

    const policy = await this.security.policy(tenant.id);

    // Checked before the password, so an address that is not allowed cannot be
    // used to test passwords at all.
    if (!(await this.addressAllowed(tenant.id, email, context, policy))) {
      throw new ForbiddenException('Sign-in is not allowed from this network');
    }

    const lockout = await this.security.lockout(email, policy);
    if (lockout.locked) {
      await this.security.recordAttempt({
        email,
        tenantId: tenant.id,
        success: false,
        reason: 'locked_out',
        ...context,
      });
      throw new HttpException(
        `Too many failed attempts. Try again after ${lockout.until?.toLocaleTimeString()}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });

    if (!user || !user.isActive) {
      await this.security.recordAttempt({
        email,
        tenantId: tenant.id,
        success: false,
        reason: user ? 'inactive' : 'unknown_user',
        ...context,
      });
      // The caller is told the same thing either way; only the history knows
      // which it was.
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.security.recordAttempt({
        email,
        tenantId: tenant.id,
        success: false,
        reason: 'bad_password',
        ...context,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.security.recordAttempt({
      email,
      tenantId: tenant.id,
      success: true,
      ...context,
    });

    return this.buildAuthResult(user, tenant.slug, context, policy.sessionDays);
  }

  /** Records the refusal as well as making it, so a blocked attempt is seen. */
  private async addressAllowed(
    tenantId: string,
    email: string,
    context: RequestContext,
    policy: { ipAllowlist: string[] },
  ): Promise<boolean> {
    if (addressAllowed(context.ipAddress, policy.ipAllowlist)) return true;

    await this.security.recordAttempt({
      email,
      tenantId,
      success: false,
      reason: 'ip_not_allowed',
      ...context,
    });
    return false;
  }

  /**
   * The signed-in user, for a client that has a token but no user in memory —
   * a page reload, which otherwise left the app not knowing who was using it.
   */
  async me(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        tenant: { select: { slug: true } },
      },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const { tenant, ...rest } = user;
    return { user: rest, tenantSlug: tenant.slug };
  }

  async refresh(
    refreshToken: string,
    context: RequestContext = {},
  ): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.security.liveSession(refreshToken);
    if (session) {
      const tokens = await this.issueTokens(user);
      // Rotated: the old token stops working the moment the new one exists, so
      // a stolen one is good for a single use at most.
      await this.security.rotateSession(
        session.id,
        tokens.refreshToken,
        context.ipAddress,
      );
      return tokens;
    }

    // A token issued before sessions existed. Honoured once, and upgraded to a
    // session, so nobody is signed out by the change.
    if (
      user.refreshToken &&
      (await bcrypt.compare(refreshToken, user.refreshToken))
    ) {
      const tokens = await this.issueTokens(user);
      const policy = await this.security.policy(user.tenantId);
      await this.security.createSession({
        tenantId: user.tenantId,
        userId: user.id,
        refreshToken: tokens.refreshToken,
        sessionDays: policy.sessionDays,
        ...context,
      });
      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: null },
      });
      return tokens;
    }

    throw new UnauthorizedException('Invalid refresh token');
  }

  /**
   * Signs out one device, not every device.
   *
   * The refresh token says which; without it there is nothing to go on, so the
   * legacy behaviour of clearing the single stored token is kept for that case.
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.security.revokeByToken(refreshToken, 'signed_out');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  private async buildAuthResult(
    user: User,
    tenantSlug: string,
    context: RequestContext = {},
    sessionDays = 7,
  ): Promise<AuthResult> {
    const tokens = await this.issueTokens(user);
    await this.security.createSession({
      tenantId: user.tenantId,
      userId: user.id,
      refreshToken: tokens.refreshToken,
      sessionDays,
      ...context,
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
      },
      tenantSlug,
      tokens,
    };
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      jti: randomUUID(),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  // Duplicate email within a tenant is prevented by DB unique constraint;
  // surface a friendly error at the controller boundary.
  async assertEmailAvailable(tenantId: string, email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
  }
}
