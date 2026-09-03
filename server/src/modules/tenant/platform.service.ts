import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../prisma/tenant-context';

/** Something worth an operator's attention about one workspace. */
export interface HealthSignal {
  level: 'warning' | 'info';
  message: string;
}

const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * Reads the signals off a workspace's numbers.
 *
 * Deliberately a pure function of counts rather than a score: "nobody has
 * signed in for three weeks" is something an operator can act on, and a
 * health score out of a hundred is not.
 */
export function healthSignals(usage: {
  users: number;
  activeUsers30d: number;
  lastLoginAt: Date | null;
  contacts: number;
  dealsOpen: number;
  dealsWon90d: number;
  failingWebhooks: number;
  storageBytes: number;
}): HealthSignal[] {
  const signals: HealthSignal[] = [];

  if (!usage.lastLoginAt) {
    signals.push({ level: 'warning', message: 'Nobody has ever signed in' });
  } else if (usage.lastLoginAt < days(21)) {
    signals.push({
      level: 'warning',
      message: `Nobody has signed in since ${usage.lastLoginAt.toDateString()}`,
    });
  }

  if (usage.users > 1 && usage.activeUsers30d <= 1) {
    signals.push({
      level: 'warning',
      message: `${usage.users} people have accounts but only ${usage.activeUsers30d} used it this month`,
    });
  }

  if (usage.contacts === 0) {
    signals.push({ level: 'info', message: 'No contacts yet' });
  }

  if (usage.dealsOpen === 0 && usage.dealsWon90d === 0 && usage.contacts > 0) {
    signals.push({
      level: 'info',
      message: 'Contacts are being kept but no deals are being worked',
    });
  }

  if (usage.failingWebhooks > 0) {
    signals.push({
      level: 'warning',
      message: `${usage.failingWebhooks} webhook${usage.failingWebhooks === 1 ? '' : 's'} failing`,
    });
  }

  if (usage.storageBytes > 5 * 1024 * 1024 * 1024) {
    signals.push({
      level: 'info',
      message: `Holding ${(usage.storageBytes / 1024 ** 3).toFixed(1)} GB of documents`,
    });
  }

  return signals;
}

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every workspace on the platform, with what it is doing.
   *
   * This is the one report that is meant to cross tenants: it exists for
   * whoever runs the platform, and is reachable only by a SUPER_ADMIN.
   */
  async tenants() {
    return TenantContext.asSystem('platform-wide usage report', async () => {
      const tenants = await this.prisma.tenant.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          isActive: true,
          createdAt: true,
          settings: { select: { customDomain: true, productName: true } },
          _count: {
            select: {
              users: true,
              contacts: true,
              companies: true,
              deals: true,
              tickets: true,
              documents: true,
            },
          },
        },
      });

      const rows = [];
      for (const tenant of tenants) {
        const [
          activeUsers,
          lastLogin,
          dealsOpen,
          dealsWon,
          storage,
          failingWebhooks,
          apiCalls,
          messages,
        ] = await Promise.all([
          this.prisma.user.count({
            where: { tenantId: tenant.id, lastLoginAt: { gte: days(30) } },
          }),
          this.prisma.user.findFirst({
            where: { tenantId: tenant.id, lastLoginAt: { not: null } },
            orderBy: { lastLoginAt: 'desc' },
            select: { lastLoginAt: true },
          }),
          this.prisma.deal.count({
            where: { tenantId: tenant.id, status: 'open' },
          }),
          this.prisma.deal.aggregate({
            where: {
              tenantId: tenant.id,
              status: 'won',
              closedAt: { gte: days(90) },
            },
            _sum: { value: true },
            _count: { _all: true },
          }),
          this.prisma.document.aggregate({
            where: { tenantId: tenant.id },
            _sum: { size: true },
          }),
          this.prisma.webhook.count({
            where: { tenantId: tenant.id, consecutiveFailures: { gt: 0 } },
          }),
          this.prisma.apiKey.aggregate({
            where: { tenantId: tenant.id },
            _sum: { requestCount: true },
          }),
          this.prisma.message.count({
            where: { tenantId: tenant.id, createdAt: { gte: days(30) } },
          }),
        ]);

        const usage = {
          users: tenant._count.users,
          activeUsers30d: activeUsers,
          lastLoginAt: lastLogin?.lastLoginAt ?? null,
          contacts: tenant._count.contacts,
          companies: tenant._count.companies,
          deals: tenant._count.deals,
          dealsOpen,
          dealsWon90d: dealsWon._count._all,
          revenueWon90d: Number(dealsWon._sum.value ?? 0),
          tickets: tenant._count.tickets,
          documents: tenant._count.documents,
          storageBytes: Number(storage._sum.size ?? 0),
          apiCalls: Number(apiCalls._sum.requestCount ?? 0),
          messages30d: messages,
          failingWebhooks,
        };

        rows.push({
          id: tenant.id,
          name: tenant.settings?.productName ?? tenant.name,
          slug: tenant.slug,
          plan: tenant.plan,
          isActive: tenant.isActive,
          customDomain: tenant.settings?.customDomain ?? null,
          createdAt: tenant.createdAt,
          usage,
          signals: healthSignals(usage),
        });
      }

      return rows;
    });
  }

  /** Turns a workspace off, or back on, without deleting anything. */
  async setActive(tenantId: string, isActive: boolean) {
    return TenantContext.asSystem(
      'suspending or restoring a workspace',
      async () => {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Workspace not found');

        // Nothing is removed: a suspended workspace stops being able to sign in,
        // and everything it holds is still there when it comes back.
        return this.prisma.tenant.update({
          where: { id: tenantId },
          data: { isActive },
          select: { id: true, name: true, isActive: true },
        });
      },
    );
  }
}
