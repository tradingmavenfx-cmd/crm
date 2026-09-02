import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

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

  async login(dto: LoginDto): Promise<AuthResult> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });
    if (!tenant || !tenant.isActive) {
      throw new UnauthorizedException(
        `Workspace "${dto.tenantSlug}" not found - check your workspace slug`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: dto.email.toLowerCase(),
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.buildAuthResult(user, tenant.slug);
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

  async refresh(refreshToken: string): Promise<AuthTokens> {
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
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const matches = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!matches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.issueTokens(user);
    await this.persistRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  private async buildAuthResult(
    user: User,
    tenantSlug: string,
  ): Promise<AuthResult> {
    const tokens = await this.issueTokens(user);
    await this.persistRefreshToken(user.id, tokens.refreshToken);
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

  private async persistRefreshToken(
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    const hashed = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed },
    });
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
