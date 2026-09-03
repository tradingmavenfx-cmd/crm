import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ForecastCategory, QuotaPeriod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TerritoriesService } from './territories.service';
import { ForecastQueryDto, UpsertQuotaDto, WhatIfDto } from './dto/sales.dto';

/**
 * How much of each category is assumed to land, when nobody says otherwise.
 *
 * These are the starting point for a what-if, not a prediction: a commit is
 * what the rep says will close, so it is discounted lightly; pipeline is
 * everything else and is discounted hard.
 */
const DEFAULT_ODDS: Record<string, number> = {
  commit: 0.9,
  bestCase: 0.5,
  pipeline: 0.2,
};

/** Where a deal lands when the rep has not said. */
export function deriveCategory(deal: {
  status: string;
  forecastCategory: ForecastCategory | null;
  probability: number;
}): ForecastCategory {
  if (deal.status === 'won') return ForecastCategory.CLOSED;
  if (deal.status === 'lost') return ForecastCategory.OMITTED;
  if (deal.forecastCategory) return deal.forecastCategory;
  if (deal.probability >= 75) return ForecastCategory.COMMIT;
  if (deal.probability >= 40) return ForecastCategory.BEST_CASE;
  return ForecastCategory.PIPELINE;
}

/** The window a period covers, as [start, end). */
export function periodRange(
  period: QuotaPeriod,
  start: Date,
): { start: Date; end: Date } {
  const from = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  if (period === QuotaPeriod.MONTH) {
    return {
      start: from,
      end: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)),
    };
  }
  if (period === QuotaPeriod.QUARTER) {
    const quarterStart = Math.floor(from.getUTCMonth() / 3) * 3;
    const begin = new Date(Date.UTC(from.getUTCFullYear(), quarterStart, 1));
    return {
      start: begin,
      end: new Date(Date.UTC(begin.getUTCFullYear(), quarterStart + 3, 1)),
    };
  }
  const begin = new Date(Date.UTC(from.getUTCFullYear(), 0, 1));
  return {
    start: begin,
    end: new Date(Date.UTC(begin.getUTCFullYear() + 1, 0, 1)),
  };
}

interface Bucket {
  closed: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  omitted: number;
  weighted: number;
  deals: number;
}

const emptyBucket = (): Bucket => ({
  closed: 0,
  commit: 0,
  bestCase: 0,
  pipeline: 0,
  omitted: 0,
  weighted: 0,
  deals: 0,
});

@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly territories: TerritoriesService,
  ) {}

  // ── Quotas ───────────────────────────────────

  async listQuotas(tenantId: string, period?: QuotaPeriod) {
    return this.prisma.quota.findMany({
      where: { tenantId, ...(period ? { period } : {}) },
      orderBy: [{ periodStart: 'desc' }],
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        territory: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Sets a quota. One quota per owner-or-territory per period, replaced when
   * it is set again — a rep with two numbers for the same quarter has none.
   */
  async upsertQuota(tenantId: string, dto: UpsertQuotaDto) {
    if (!dto.ownerId === !dto.territoryId) {
      throw new BadRequestException(
        'A quota belongs to either a person or a territory, not both',
      );
    }

    const { start } = periodRange(dto.period, new Date(dto.periodStart));

    // Postgres treats NULLs as distinct, so a unique index over nullable
    // owner/territory columns would not actually stop a duplicate.
    const existing = await this.prisma.quota.findFirst({
      where: {
        tenantId,
        period: dto.period,
        periodStart: start,
        ownerId: dto.ownerId ?? null,
        territoryId: dto.territoryId ?? null,
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.quota.update({
        where: { id: existing.id },
        data: { amount: dto.amount, currency: dto.currency },
      });
    }

    return this.prisma.quota.create({
      data: {
        tenantId,
        ownerId: dto.ownerId,
        territoryId: dto.territoryId,
        period: dto.period,
        periodStart: start,
        amount: dto.amount,
        currency: dto.currency ?? 'INR',
      },
    });
  }

  async removeQuota(tenantId: string, id: string) {
    await this.prisma.quota.deleteMany({ where: { id, tenantId } });
    return { success: true };
  }

  // ── The forecast ─────────────────────────────

  /**
   * The forecast for a period, per rep and rolled up.
   *
   * A deal counts towards the period it is expected to close in; a deal
   * already won counts in the period it closed. An open deal with no expected
   * date cannot be forecast into any particular period, so it is reported
   * separately rather than quietly dropped or dumped into this one.
   */
  async forecast(tenantId: string, query: ForecastQueryDto) {
    const period = query.period ?? QuotaPeriod.QUARTER;
    const { start, end } = periodRange(
      period,
      query.periodStart ? new Date(query.periodStart) : new Date(),
    );

    const territoryIds = query.territoryId
      ? await this.territories.subtree(tenantId, query.territoryId)
      : null;

    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        ...(query.ownerId ? { ownerId: query.ownerId } : {}),
        ...(territoryIds
          ? { company: { territoryId: { in: territoryIds } } }
          : {}),
        OR: [
          { expectedAt: { gte: start, lt: end } },
          { closedAt: { gte: start, lt: end } },
        ],
      },
      select: {
        id: true,
        value: true,
        status: true,
        forecastCategory: true,
        ownerId: true,
        expectedAt: true,
        owner: { select: { id: true, firstName: true, lastName: true } },
        stage: { select: { probability: true } },
      },
    });

    const buckets = new Map<string, Bucket>();
    const names = new Map<string, string>();
    const add = (key: string, deal: (typeof deals)[number]) => {
      const bucket = buckets.get(key) ?? emptyBucket();
      const value = Number(deal.value);
      const category = deriveCategory({
        status: deal.status,
        forecastCategory: deal.forecastCategory,
        probability: deal.stage.probability,
      });

      bucket.deals += 1;
      if (category === ForecastCategory.CLOSED) bucket.closed += value;
      else if (category === ForecastCategory.COMMIT) bucket.commit += value;
      else if (category === ForecastCategory.BEST_CASE) {
        bucket.bestCase += value;
      } else if (category === ForecastCategory.PIPELINE) {
        bucket.pipeline += value;
      } else bucket.omitted += value;

      // The stage's own probability, which is the number the pipeline was
      // built on, rather than a second opinion invented here.
      if (deal.status === 'open') {
        bucket.weighted += (value * deal.stage.probability) / 100;
      } else if (deal.status === 'won') {
        bucket.weighted += value;
      }

      buckets.set(key, bucket);
    };

    for (const deal of deals) {
      const key = deal.ownerId ?? 'unassigned';
      if (deal.owner) {
        names.set(key, `${deal.owner.firstName} ${deal.owner.lastName}`);
      } else names.set(key, 'Unassigned');
      add(key, deal);
    }

    const quotas = await this.prisma.quota.findMany({
      where: { tenantId, period, periodStart: start },
      select: { ownerId: true, territoryId: true, amount: true },
    });
    const quotaFor = new Map(
      quotas
        .filter((q) => q.ownerId)
        .map((q) => [q.ownerId!, Number(q.amount)]),
    );

    // A rep who carries a quota but has nothing in the period still belongs on
    // the sheet: at zero, they are exactly who a manager is looking for.
    for (const quota of quotas) {
      if (!quota.ownerId || buckets.has(quota.ownerId)) continue;
      buckets.set(quota.ownerId, emptyBucket());
      if (!names.has(quota.ownerId)) {
        const person = await this.prisma.user.findFirst({
          where: { id: quota.ownerId, tenantId },
          select: { firstName: true, lastName: true },
        });
        names.set(
          quota.ownerId,
          person ? `${person.firstName} ${person.lastName}` : 'Unknown',
        );
      }
    }

    const rows = [...buckets.entries()].map(([ownerId, b]) => {
      const quota = quotaFor.get(ownerId) ?? 0;
      const committed = b.closed + b.commit;
      return {
        ownerId: ownerId === 'unassigned' ? null : ownerId,
        owner: names.get(ownerId) ?? 'Unassigned',
        quota,
        closed: b.closed,
        commit: b.commit,
        bestCase: b.bestCase,
        pipeline: b.pipeline,
        omitted: b.omitted,
        weighted: Math.round(b.weighted),
        deals: b.deals,
        attainment: quota ? Math.round((b.closed / quota) * 100) : null,
        // What is still missing to hit the number on today's commitments.
        gap: quota ? Math.round(quota - committed) : null,
      };
    });

    const sum = (pick: (r: (typeof rows)[number]) => number) =>
      rows.reduce((total, r) => total + pick(r), 0);

    // Rep quotas and a territory quota cover the same deals, so adding both
    // would count the target twice. Looking at one territory uses its own
    // number when it has one; otherwise the reps' quotas are the team's.
    const territoryQuota = query.territoryId
      ? quotas.find((q) => q.territoryId === query.territoryId)
      : undefined;
    const teamQuota = territoryQuota
      ? Number(territoryQuota.amount)
      : quotas
          .filter((q) => q.ownerId)
          .reduce((total, q) => total + Number(q.amount), 0);

    const undated = await this.prisma.deal.count({
      where: {
        tenantId,
        status: 'open',
        expectedAt: null,
        ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      },
    });

    return {
      period,
      periodStart: start,
      periodEnd: end,
      rows: rows.sort((a, b) => b.closed - a.closed),
      total: {
        quota: teamQuota,
        closed: sum((r) => r.closed),
        commit: sum((r) => r.commit),
        bestCase: sum((r) => r.bestCase),
        pipeline: sum((r) => r.pipeline),
        weighted: sum((r) => r.weighted),
        deals: sum((r) => r.deals),
      },
      // Open deals with no expected date belong to no period; they are
      // reported here rather than being silently forecast into this one.
      dealsWithoutExpectedDate: undated,
    };
  }

  /**
   * The same period under different assumptions.
   *
   * Nothing is written: this answers "what would it take", which is a question
   * about the numbers, not a change to them.
   */
  async whatIf(tenantId: string, dto: WhatIfDto) {
    const base = await this.forecast(tenantId, dto);
    const odds = {
      commit: dto.commitOdds ?? DEFAULT_ODDS.commit,
      bestCase: dto.bestCaseOdds ?? DEFAULT_ODDS.bestCase,
      pipeline: dto.pipelineOdds ?? DEFAULT_ODDS.pipeline,
    };

    const project = (row: {
      closed: number;
      commit: number;
      bestCase: number;
      pipeline: number;
    }) =>
      Math.round(
        row.closed +
          row.commit * odds.commit +
          row.bestCase * odds.bestCase +
          row.pipeline * odds.pipeline,
      );

    const rows = base.rows.map((r) => ({
      ...r,
      projected: project(r),
      projectedAttainment: r.quota
        ? Math.round((project(r) / r.quota) * 100)
        : null,
    }));

    const projected = project(base.total);

    return {
      ...base,
      odds,
      rows,
      total: {
        ...base.total,
        projected,
        projectedAttainment: base.total.quota
          ? Math.round((projected / base.total.quota) * 100)
          : null,
        shortfall: base.total.quota
          ? Math.max(0, Math.round(base.total.quota - projected))
          : null,
      },
    };
  }

  /** Sets a deal's forecast category by hand. */
  async categorise(
    tenantId: string,
    dealId: string,
    category: ForecastCategory,
  ) {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId },
      select: { id: true },
    });
    if (!deal) throw new BadRequestException('Deal not found');

    return this.prisma.deal.update({
      where: { id: dealId },
      data: { forecastCategory: category },
    });
  }

  // ── Accuracy ─────────────────────────────────

  /** Writes down what the forecast said today, per rep. */
  async takeSnapshot(
    tenantId: string,
    period: QuotaPeriod = QuotaPeriod.QUARTER,
  ) {
    const current = await this.forecast(tenantId, { period });

    for (const row of current.rows) {
      if (!row.ownerId) continue;
      await this.prisma.forecastSnapshot.create({
        data: {
          tenantId,
          ownerId: row.ownerId,
          period,
          periodStart: current.periodStart,
          closed: row.closed,
          commit: row.commit,
          bestCase: row.bestCase,
          pipeline: row.pipeline,
          weighted: row.weighted,
          quota: row.quota,
        },
      });
    }

    return { taken: current.rows.filter((r) => r.ownerId).length };
  }

  /**
   * How good the calls turned out to be.
   *
   * Scored against the earliest snapshot in each period — a forecast made on
   * the last day of the quarter is not a forecast, and grading against it
   * would flatter everyone.
   */
  async accuracy(tenantId: string, ownerId?: string) {
    const snapshots = await this.prisma.forecastSnapshot.findMany({
      where: { tenantId, ...(ownerId ? { ownerId } : {}) },
      orderBy: [{ periodStart: 'desc' }, { takenAt: 'asc' }],
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const now = new Date();
    const first = new Map<string, (typeof snapshots)[number]>();
    for (const snap of snapshots) {
      const key = `${snap.ownerId ?? 'team'}:${snap.periodStart.toISOString()}`;
      if (!first.has(key)) first.set(key, snap);
    }

    const rows = [];
    for (const snap of first.values()) {
      const { end } = periodRange(snap.period, snap.periodStart);
      if (end > now) continue; // The period is still running; nothing to score.

      const won = await this.prisma.deal.aggregate({
        where: {
          tenantId,
          ownerId: snap.ownerId ?? undefined,
          status: 'won',
          closedAt: { gte: snap.periodStart, lt: end },
        },
        _sum: { value: true },
      });

      const actual = Number(won._sum.value ?? 0);
      const called = Number(snap.closed) + Number(snap.commit);

      rows.push({
        owner: snap.owner
          ? `${snap.owner.firstName} ${snap.owner.lastName}`
          : 'Team',
        periodStart: snap.periodStart,
        period: snap.period,
        takenAt: snap.takenAt,
        called: Math.round(called),
        actual: Math.round(actual),
        // Over 100% means they beat their own call; under, they missed it.
        accuracy: called ? Math.round((actual / called) * 100) : null,
      });
    }

    return rows;
  }

  /** A weekly snapshot, so accuracy has something to be measured against. */
  @Cron(CronExpression.EVERY_WEEK)
  async weeklySnapshot() {
    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const tenant of tenants) {
      try {
        await this.takeSnapshot(tenant.id);
      } catch (err) {
        this.logger.error(
          `Forecast snapshot failed for ${tenant.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }
}
