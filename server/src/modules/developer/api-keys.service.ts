import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../prisma/tenant-context';
import { CreateApiKeyDto } from './dto/developer.dto';

/** Marks the key as belonging to this product, so a leaked one is recognisable. */
const PREFIX = 'crm_';

/**
 * What a key is allowed to do.
 *
 * A scope is `resource:action`; `*` means everything. Kept deliberately coarse
 * — a key that can read contacts can read all of them — because a permission
 * model nobody can predict the behaviour of is worse than a simple one.
 */
export interface KeyIdentity {
  apiKeyId: string;
  tenantId: string;
  scopes: string[];
}

export function scopeAllows(scopes: string[], required: string): boolean {
  if (scopes.includes('*')) return true;
  if (scopes.includes(required)) return true;

  const [resource, action] = required.split(':');
  // "contacts:*" covers every action on contacts.
  if (scopes.includes(`${resource}:*`)) return true;
  // Writing implies reading: a key that may change a contact may see it.
  if (action === 'read' && scopes.includes(`${resource}:write`)) return true;
  return false;
}

/**
 * How many requests a key has made in the last minute.
 *
 * Held in memory, so the limit is per process: two instances behind a load
 * balancer allow twice this. Said plainly rather than implied — a shared
 * counter needs a store this project does not have yet.
 */
class RequestWindow {
  private readonly hits = new Map<string, number[]>();

  /** True when the caller is within its limit; records the request either way. */
  take(key: string, limitPerMinute: number): boolean {
    const now = Date.now();
    const since = now - 60_000;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > since);
    recent.push(now);
    this.hits.set(key, recent);

    // Bounded: a key that stops calling stops being remembered.
    if (this.hits.size > 10_000) this.hits.clear();
    return recent.length <= limitPerMinute;
  }

  countFor(key: string): number {
    const since = Date.now() - 60_000;
    return (this.hits.get(key) ?? []).filter((at) => at > since).length;
  }
}

@Injectable()
export class ApiKeysService {
  private readonly window = new RequestWindow();

  constructor(private readonly prisma: PrismaService) {}

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  list(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        rateLimitPerMinute: true,
        lastUsedAt: true,
        lastUsedIp: true,
        requestCount: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  /**
   * Makes a key.
   *
   * The key itself is returned once and never again: only its hash is kept, so
   * a database dump does not hand somebody a working credential.
   */
  async create(tenantId: string, userId: string, dto: CreateApiKeyDto) {
    const secret = randomBytes(24).toString('base64url');
    const key = `${PREFIX}${secret}`;

    const record = await this.prisma.apiKey.create({
      data: {
        tenantId,
        name: dto.name,
        prefix: key.slice(0, 11),
        keyHash: this.hash(key),
        scopes: dto.scopes?.length ? dto.scopes : ['*'],
        rateLimitPerMinute: dto.rateLimitPerMinute ?? 120,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        createdById: userId || undefined,
      },
    });

    return {
      id: record.id,
      name: record.name,
      scopes: record.scopes,
      // Shown once. There is no way to recover it later.
      key,
    };
  }

  async revoke(tenantId: string, id: string) {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id, tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('API key not found');
    return { success: true };
  }

  /**
   * Resolves a presented key.
   *
   * Looked up across tenants on purpose: which workspace the key belongs to is
   * the thing being determined, so this is one of the few places that has to
   * step outside the tenant scope.
   */
  async authenticate(
    presented: string,
    ip?: string,
  ): Promise<KeyIdentity & { rateLimitPerMinute: number }> {
    const invalid = () => new UnauthorizedException('Invalid API key');
    if (!presented.startsWith(PREFIX)) throw invalid();

    const record = await TenantContext.asSystem('resolving an API key', () =>
      this.prisma.apiKey.findUnique({
        where: { keyHash: this.hash(presented) },
      }),
    );

    // Unknown, revoked and expired are the same answer from outside.
    if (!record || record.revokedAt) throw invalid();
    if (record.expiresAt && record.expiresAt < new Date()) throw invalid();

    // Recorded within the key's own workspace, so this write is scoped like
    // everything else.
    await TenantContext.asTenant(record.tenantId, () =>
      this.prisma.apiKey.update({
        where: { id: record.id },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: ip,
          requestCount: { increment: 1 },
        },
      }),
    );

    return {
      apiKeyId: record.id,
      tenantId: record.tenantId,
      scopes: record.scopes,
      rateLimitPerMinute: record.rateLimitPerMinute,
    };
  }

  /** True while the key is inside its rate limit. */
  withinRateLimit(apiKeyId: string, limitPerMinute: number): boolean {
    return this.window.take(apiKeyId, limitPerMinute);
  }

  usedThisMinute(apiKeyId: string): number {
    return this.window.countFor(apiKeyId);
  }
}
