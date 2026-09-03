import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, ContestMetric, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateBadgeDto,
  CreateContestDto,
  LeaderboardDto,
} from './dto/sales.dto';

/**
 * What each metric is worth in the overall standing.
 *
 * Points are derived from the records every time they are asked for, never
 * banked in a ledger: a deal that is later marked lost should cost its points
 * back, and a stored balance would quietly keep them.
 */
export const POINTS: Record<ContestMetric, number> = {
  // Per ₹1,000 of won revenue, so a big deal outweighs a flurry of calls.
  REVENUE_WON: 1,
  DEALS_WON: 50,
  CALLS_MADE: 2,
  MEETINGS_HELD: 5,
  TICKETS_RESOLVED: 3,
};

export interface Standing {
  userId: string;
  name: string;
  revenueWon: number;
  dealsWon: number;
  callsMade: number;
  meetingsHeld: number;
  ticketsResolved: number;
  points: number;
}

export function scoreOf(row: Omit<Standing, 'points' | 'userId' | 'name'>) {
  return Math.round(
    (row.revenueWon / 1000) * POINTS.REVENUE_WON +
      row.dealsWon * POINTS.DEALS_WON +
      row.callsMade * POINTS.CALLS_MADE +
      row.meetingsHeld * POINTS.MEETINGS_HELD +
      row.ticketsResolved * POINTS.TICKETS_RESOLVED,
  );
}

const metricValue = (row: Standing, metric: ContestMetric): number => {
  switch (metric) {
    case ContestMetric.REVENUE_WON:
      return row.revenueWon;
    case ContestMetric.DEALS_WON:
      return row.dealsWon;
    case ContestMetric.CALLS_MADE:
      return row.callsMade;
    case ContestMetric.MEETINGS_HELD:
      return row.meetingsHeld;
    case ContestMetric.TICKETS_RESOLVED:
      return row.ticketsResolved;
  }
};

@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everyone's numbers over a window, counted from the records themselves.
   *
   * Users with nothing to show still appear: a leaderboard that hides the
   * bottom half is a highlight reel, not a standing.
   */
  async standings(
    tenantId: string,
    from?: Date,
    to?: Date,
  ): Promise<Standing[]> {
    const range = (field: string) =>
      from || to
        ? {
            [field]: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: to } : {}),
            },
          }
        : {};

    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    const won = await this.prisma.deal.groupBy({
      by: ['ownerId'],
      where: { tenantId, status: 'won', ...range('closedAt') },
      _sum: { value: true },
      _count: { _all: true },
    });

    const activities = await this.prisma.activity.groupBy({
      by: ['userId', 'type'],
      where: {
        tenantId,
        type: { in: [ActivityType.CALL, ActivityType.MEETING] },
        ...range('createdAt'),
      },
      _count: { _all: true },
    });

    const tickets = await this.prisma.ticket.groupBy({
      by: ['assigneeId'],
      where: {
        tenantId,
        status: { in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        ...range('resolvedAt'),
      },
      _count: { _all: true },
    });

    return users
      .map((user) => {
        const deals = won.find((w) => w.ownerId === user.id);
        const calls = activities.find(
          (a) => a.userId === user.id && a.type === ActivityType.CALL,
        );
        const meetings = activities.find(
          (a) => a.userId === user.id && a.type === ActivityType.MEETING,
        );
        const resolved = tickets.find((t) => t.assigneeId === user.id);

        const row = {
          revenueWon: Number(deals?._sum.value ?? 0),
          dealsWon: deals?._count._all ?? 0,
          callsMade: calls?._count._all ?? 0,
          meetingsHeld: meetings?._count._all ?? 0,
          ticketsResolved: resolved?._count._all ?? 0,
        };

        return {
          userId: user.id,
          name: `${user.firstName} ${user.lastName}`,
          ...row,
          points: scoreOf(row),
        };
      })
      .sort((a, b) => b.points - a.points);
  }

  async leaderboard(tenantId: string, dto: LeaderboardDto) {
    const now = new Date();
    const from =
      dto.from != null
        ? new Date(dto.from)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = dto.to ? new Date(dto.to) : undefined;

    const rows = await this.standings(tenantId, from, to);
    const metric = dto.metric;

    const ranked = metric
      ? [...rows].sort(
          (a, b) => metricValue(b, metric) - metricValue(a, metric),
        )
      : rows;

    return {
      from,
      to: to ?? null,
      metric: metric ?? null,
      rows: ranked.map((row, i) => ({
        rank: i + 1,
        ...row,
        ...(metric ? { value: metricValue(row, metric) } : {}),
      })),
    };
  }

  // ── Contests ─────────────────────────────────

  listContests(tenantId: string) {
    return this.prisma.contest.findMany({
      where: { tenantId },
      orderBy: { startsAt: 'desc' },
    });
  }

  createContest(tenantId: string, dto: CreateContestDto) {
    return this.prisma.contest.create({
      data: {
        tenantId,
        name: dto.name,
        metric: dto.metric,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        prize: dto.prize,
      },
    });
  }

  async removeContest(tenantId: string, id: string) {
    await this.prisma.contest.deleteMany({ where: { id, tenantId } });
    return { success: true };
  }

  /** A contest's standing over exactly its own window. */
  async contestStandings(tenantId: string, id: string) {
    const contest = await this.prisma.contest.findFirst({
      where: { id, tenantId },
    });
    if (!contest) throw new NotFoundException('Contest not found');

    const rows = await this.standings(
      tenantId,
      contest.startsAt,
      contest.endsAt,
    );

    return {
      contest,
      running: contest.startsAt <= new Date() && contest.endsAt > new Date(),
      rows: rows
        .map((row) => ({
          userId: row.userId,
          name: row.name,
          value: metricValue(row, contest.metric),
        }))
        .sort((a, b) => b.value - a.value)
        .map((row, i) => ({ rank: i + 1, ...row })),
    };
  }

  // ── Badges ───────────────────────────────────

  listBadges(tenantId: string) {
    return this.prisma.badge.findMany({
      where: { tenantId },
      orderBy: { threshold: 'asc' },
      include: {
        earned: {
          select: {
            earnedAt: true,
            value: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
  }

  createBadge(tenantId: string, dto: CreateBadgeDto) {
    return this.prisma.badge.create({
      data: {
        tenantId,
        key: dto.key,
        name: dto.name,
        description: dto.description,
        icon: dto.icon ?? 'star',
        metric: dto.metric,
        threshold: dto.threshold,
      },
    });
  }

  async removeBadge(tenantId: string, id: string) {
    await this.prisma.badge.deleteMany({ where: { id, tenantId } });
    return { success: true };
  }

  /**
   * Awards whatever has been earned.
   *
   * Measured over all time, and awarded once: a badge is a record that
   * somebody reached a mark, so it survives a later bad quarter. The figure
   * that earned it is stored with it, so the award can be explained.
   */
  async awardBadges(tenantId: string) {
    const badges = await this.prisma.badge.findMany({ where: { tenantId } });
    if (badges.length === 0) return { awarded: 0 };

    const rows = await this.standings(tenantId);
    const already = await this.prisma.userBadge.findMany({
      where: { tenantId },
      select: { userId: true, badgeId: true },
    });
    const held = new Set(already.map((a) => `${a.userId}:${a.badgeId}`));

    const awards: { userId: string; badgeId: string; value: number }[] = [];
    for (const badge of badges) {
      const threshold = Number(badge.threshold);
      for (const row of rows) {
        if (held.has(`${row.userId}:${badge.id}`)) continue;
        const value = metricValue(row, badge.metric);
        if (value >= threshold) {
          awards.push({ userId: row.userId, badgeId: badge.id, value });
        }
      }
    }

    for (const award of awards) {
      await this.prisma.userBadge.create({
        data: {
          tenantId,
          userId: award.userId,
          badgeId: award.badgeId,
          value: award.value,
        },
      });
    }

    return { awarded: awards.length };
  }

  /** One person's shelf. */
  async userBadges(tenantId: string, userId: string) {
    return this.prisma.userBadge.findMany({
      where: { tenantId, userId },
      orderBy: { earnedAt: 'desc' },
      include: {
        badge: {
          select: { key: true, name: true, description: true, icon: true },
        },
      },
    });
  }
}
