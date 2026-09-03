import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryAuditDto } from './dto/security.dto';

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Fields never written into an audit entry, whatever the caller passes.
 *
 * An audit trail that quietly copies password hashes and tokens into a table
 * built to be read by admins has made the problem worse, not better.
 */
const NEVER_RECORD = new Set([
  'password',
  'passwordHash',
  'refreshToken',
  'token',
  'tokenHash',
  'accessToken',
  'csatToken',
  'publicToken',
  'apiKey',
  'secret',
]);

/** What actually changed between two versions of a record. */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldChange[] {
  if (!before || !after) return [];

  const changes: FieldChange[] = [];
  for (const field of Object.keys(after)) {
    if (NEVER_RECORD.has(field)) continue;

    const from = before[field];
    const to = after[field];
    if (from === undefined && to === undefined) continue;

    // Dates and Decimals compare badly by identity, so everything is compared
    // by its serialised form.
    const left = serialise(from);
    const right = serialise(to);
    if (left !== right)
      changes.push({ field, from: revive(left), to: revive(right) });
  }
  return changes;
}

function serialise(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function revive(value: string): unknown {
  return value === 'null' ? null : value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one entry.
   *
   * Never throws: an audit failure must not be able to roll back the thing it
   * was recording, or a full disk would start refusing edits.
   */
  async record(input: {
    tenantId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    changes?: FieldChange[];
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    try {
      const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
      if (input.changes?.length) metadata.changes = input.changes;

      return await this.prisma.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? undefined,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? undefined,
          ipAddress: input.ipAddress,
          metadata: Object.keys(metadata).length
            ? (metadata as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      });
    } catch (err) {
      this.logger.error(
        `Audit entry not written: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /** Records an edit, working out the changed fields itself. */
  recordChange(input: {
    tenantId: string;
    userId?: string | null;
    entityType: string;
    entityId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    ipAddress?: string;
  }) {
    const changes = diffRecords(input.before, input.after);
    // Nothing actually changed: an entry saying so is noise in a trail people
    // have to read.
    if (changes.length === 0) return Promise.resolve(null);

    return this.record({ ...input, action: 'updated', changes });
  }

  async list(tenantId: string, query: QueryAuditDto) {
    const where: Prisma.AuditLogWhereInput = { tenantId };
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 100, 500),
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return rows.map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
        by: row.user
          ? `${row.user.firstName} ${row.user.lastName}`
          : 'The system',
        changes: (metadata.changes as FieldChange[] | undefined) ?? [],
        metadata: Object.fromEntries(
          Object.entries(metadata).filter(([key]) => key !== 'changes'),
        ),
      };
    });
  }

  /** Everything that has happened to one record, oldest first. */
  async historyOf(tenantId: string, entityType: string, entityId: string) {
    const rows = await this.list(tenantId, {
      entityType,
      entityId,
      limit: 200,
    });
    return rows.reverse();
  }
}
