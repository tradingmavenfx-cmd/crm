import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSecurityPolicyDto } from './dto/security.dto';

/** Defaults for a tenant that has never set a policy. */
export const DEFAULT_POLICY = {
  ipAllowlist: [] as string[],
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
  sessionDays: 7,
  loginRetentionDays: null as number | null,
  auditRetentionDays: null as number | null,
};

export type SecurityPolicy = typeof DEFAULT_POLICY;

/**
 * Does an address fall inside an allowlist entry?
 *
 * Supports an exact address or a CIDR block. IPv4 only: an IPv6 entry is
 * compared exactly rather than pretended to be understood, because a
 * half-implemented IPv6 mask would let addresses through that look blocked.
 */
export function addressAllowed(
  ip: string | undefined,
  allowlist: string[],
): boolean {
  if (allowlist.length === 0) return true; // No list means anywhere.
  if (!ip) return false; // A list is set and we cannot tell who this is.

  // Express reports IPv4 through an IPv6 socket as ::ffff:1.2.3.4.
  const address = ip.replace(/^::ffff:/, '');

  return allowlist.some((entry) => {
    const rule = entry.trim();
    if (!rule) return false;
    if (!rule.includes('/')) return rule === address || rule === ip;

    const [block, bitsText] = rule.split('/');
    const bits = Number(bitsText);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

    const toInt = (value: string): number | null => {
      const parts = value.split('.');
      if (parts.length !== 4) return null;
      let total = 0;
      for (const part of parts) {
        const octet = Number(part);
        if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
        total = total * 256 + octet;
      }
      return total;
    };

    const left = toInt(address);
    const right = toInt(block);
    if (left === null || right === null) return false;

    // A /0 shifts by 32, which JavaScript treats as a shift by 0; spelled out
    // rather than relying on that.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (left & mask) === (right & mask);
  });
}

/** A readable label for a device, from its user agent. */
export function describeDevice(userAgent?: string): string {
  if (!userAgent) return 'Unknown device';

  const browser = /edg\//i.test(userAgent)
    ? 'Edge'
    : /opr\//i.test(userAgent)
      ? 'Opera'
      : /chrome\//i.test(userAgent)
        ? 'Chrome'
        : /safari\//i.test(userAgent)
          ? 'Safari'
          : /firefox\//i.test(userAgent)
            ? 'Firefox'
            : /curl\//i.test(userAgent)
              ? 'curl'
              : 'Unknown browser';

  const platform = /windows/i.test(userAgent)
    ? 'Windows'
    : /android/i.test(userAgent)
      ? 'Android'
      : /iphone|ipad/i.test(userAgent)
        ? 'iOS'
        : /mac os/i.test(userAgent)
          ? 'macOS'
          : /linux/i.test(userAgent)
            ? 'Linux'
            : null;

  return platform ? `${browser} on ${platform}` : browser;
}

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(private readonly prisma: PrismaService) {}

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // ── Policy ───────────────────────────────────

  async policy(tenantId: string): Promise<SecurityPolicy> {
    const row = await this.prisma.tenantSecurity.findUnique({
      where: { tenantId },
    });
    if (!row) return { ...DEFAULT_POLICY };

    return {
      ipAllowlist: row.ipAllowlist,
      maxFailedAttempts: row.maxFailedAttempts,
      lockoutMinutes: row.lockoutMinutes,
      sessionDays: row.sessionDays,
      loginRetentionDays: row.loginRetentionDays,
      auditRetentionDays: row.auditRetentionDays,
    };
  }

  async updatePolicy(tenantId: string, dto: UpdateSecurityPolicyDto) {
    return this.prisma.tenantSecurity.upsert({
      where: { tenantId },
      update: { ...dto },
      create: { tenantId, ...dto },
    });
  }

  // ── Sign-in attempts ─────────────────────────

  recordAttempt(input: {
    email: string;
    success: boolean;
    tenantId?: string | null;
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.loginAttempt.create({
      data: {
        email: input.email.toLowerCase(),
        success: input.success,
        tenantId: input.tenantId ?? undefined,
        reason: input.reason,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  /**
   * Is this account locked out right now?
   *
   * Counted since the last success, so signing in correctly clears the slate
   * rather than leaving yesterday's typos to lock somebody out today.
   */
  async lockout(
    email: string,
    policy: SecurityPolicy,
  ): Promise<{ locked: boolean; failures: number; until?: Date }> {
    const address = email.toLowerCase();
    const window = new Date(Date.now() - policy.lockoutMinutes * 60 * 1000);

    const recent = await this.prisma.loginAttempt.findMany({
      where: { email: address, createdAt: { gte: window } },
      orderBy: { createdAt: 'desc' },
      select: { success: true, createdAt: true },
    });

    const failures: Date[] = [];
    for (const attempt of recent) {
      if (attempt.success) break;
      failures.push(attempt.createdAt);
    }

    if (failures.length < policy.maxFailedAttempts) {
      return { locked: false, failures: failures.length };
    }

    const newest = failures[0];
    return {
      locked: true,
      failures: failures.length,
      until: new Date(newest.getTime() + policy.lockoutMinutes * 60 * 1000),
    };
  }

  /** Refuses a sign-in from an address the tenant has not allowed. */
  assertAddressAllowed(ip: string | undefined, policy: SecurityPolicy) {
    if (!addressAllowed(ip, policy.ipAllowlist)) {
      throw new ForbiddenException('Sign-in is not allowed from this network');
    }
  }

  // ── Sessions ─────────────────────────────────

  async createSession(input: {
    tenantId: string;
    userId: string;
    refreshToken: string;
    sessionDays: number;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.userSession.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        tokenHash: this.hash(input.refreshToken),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        device: describeDevice(input.userAgent),
        expiresAt: new Date(
          Date.now() + input.sessionDays * 24 * 60 * 60 * 1000,
        ),
      },
    });
  }

  /** The session a refresh token belongs to, if it is still live. */
  async liveSession(refreshToken: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.hash(refreshToken) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return null;
    }
    return session;
  }

  /**
   * Swaps the token a session is addressed by.
   *
   * The old token stops working the moment the new one is issued, so a stolen
   * refresh token is good for one use at most — and the theft shows up as the
   * real user being signed out.
   */
  async rotateSession(sessionId: string, refreshToken: string, ip?: string) {
    return this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        tokenHash: this.hash(refreshToken),
        lastSeenAt: new Date(),
        ipAddress: ip ?? undefined,
      },
    });
  }

  listSessions(tenantId: string, userId: string) {
    return this.prisma.userSession.findMany({
      where: { tenantId, userId },
      orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }],
      select: {
        id: true,
        device: true,
        ipAddress: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        revokedReason: true,
      },
    });
  }

  async revokeSession(
    tenantId: string,
    userId: string,
    sessionId: string,
    reason = 'revoked_by_user',
  ) {
    // Scoped to the user as well as the tenant: one person must not be able to
    // sign another out by guessing a session id.
    const { count } = await this.prisma.userSession.updateMany({
      where: { id: sessionId, tenantId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return { revoked: count };
  }

  async revokeByToken(refreshToken: string, reason = 'signed_out') {
    const { count } = await this.prisma.userSession.updateMany({
      where: { tokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return { revoked: count };
  }

  /** Signs a user out everywhere — used on a password change, and by hand. */
  async revokeAll(userId: string, reason: string, exceptSessionId?: string) {
    const { count } = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return { revoked: count };
  }

  // ── History ──────────────────────────────────

  /** Sign-ins and failures, newest first. */
  loginHistory(tenantId: string, email?: string, limit = 50) {
    return this.prisma.loginAttempt.findMany({
      where: {
        tenantId,
        ...(email ? { email: email.toLowerCase() } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: {
        id: true,
        email: true,
        success: true,
        reason: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
    });
  }

  // ── Retention ────────────────────────────────

  /**
   * Deletes history a tenant has said it does not want to keep.
   *
   * Only runs where a retention period is actually set: silently discarding a
   * tenant's audit trail because nobody chose a number would be worse than
   * keeping it.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async applyRetention() {
    const policies = await this.prisma.tenantSecurity.findMany({
      where: {
        OR: [
          { loginRetentionDays: { not: null } },
          { auditRetentionDays: { not: null } },
        ],
      },
    });

    let logins = 0;
    let audits = 0;

    for (const policy of policies) {
      if (policy.loginRetentionDays) {
        const before = new Date(
          Date.now() - policy.loginRetentionDays * 24 * 60 * 60 * 1000,
        );
        const { count } = await this.prisma.loginAttempt.deleteMany({
          where: { tenantId: policy.tenantId, createdAt: { lt: before } },
        });
        logins += count;
      }

      if (policy.auditRetentionDays) {
        const before = new Date(
          Date.now() - policy.auditRetentionDays * 24 * 60 * 60 * 1000,
        );
        const { count } = await this.prisma.auditLog.deleteMany({
          where: { tenantId: policy.tenantId, createdAt: { lt: before } },
        });
        audits += count;
      }
    }

    if (logins || audits) {
      this.logger.log(
        `Retention removed ${logins} sign-in records and ${audits} audit entries`,
      );
    }
    return { logins, audits };
  }

  /** Tidies away sessions that have simply run out. */
  @Cron(CronExpression.EVERY_HOUR)
  async expireSessions() {
    const { count } = await this.prisma.userSession.updateMany({
      where: { revokedAt: null, expiresAt: { lt: new Date() } },
      data: { revokedAt: new Date(), revokedReason: 'expired' },
    });
    return { expired: count };
  }
}
