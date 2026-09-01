import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CallDirection,
  CallStatus,
  Channel,
  MessageDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { REPORTS, REPORT_KEYS } from './report-registry';

export interface ReportParams {
  /** Look-back window in days; defaults per report */
  days?: number;
}

/**
 * A report is a titled table plus optional headline figures. Keeping one shape
 * for every report is what lets the dashboard render any of them with any of
 * the chart types the registry allows.
 */
export interface ReportResult {
  key: string;
  name: string;
  /** Column keys in display order; the first is treated as the label */
  columns: { key: string; label: string; type?: 'number' | 'money' | 'text' }[];
  rows: Record<string, unknown>[];
  /** Headline numbers shown above the chart */
  stats?: { label: string; value: string | number }[];
  generatedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  listReports() {
    return REPORTS;
  }

  private since(days?: number, fallback = 90): Date {
    return new Date(Date.now() - (days ?? fallback) * DAY_MS);
  }

  private round(n: number, dp = 1): number {
    const f = 10 ** dp;
    return Math.round(n * f) / f;
  }

  async run(
    tenantId: string,
    key: string,
    params: ReportParams = {},
  ): Promise<ReportResult> {
    if (!REPORT_KEYS.includes(key)) {
      throw new BadRequestException(`Unknown report: ${key}`);
    }
    const meta = REPORTS.find((r) => r.key === key)!;

    const body = await this.compute(tenantId, key, params);
    return {
      key,
      name: meta.name,
      generatedAt: new Date().toISOString(),
      ...body,
    };
  }

  private compute(
    tenantId: string,
    key: string,
    params: ReportParams,
  ): Promise<Omit<ReportResult, 'key' | 'name' | 'generatedAt'>> {
    switch (key) {
      case 'sales.pipeline':
        return this.pipeline(tenantId);
      case 'sales.forecast':
        return this.forecast(tenantId);
      case 'sales.leaderboard':
        return this.leaderboard(tenantId, params);
      case 'sales.win_loss':
        return this.winLoss(tenantId, params);
      case 'sales.cycle':
        return this.salesCycle(tenantId, params);
      case 'marketing.campaigns':
        return this.campaigns(tenantId);
      case 'marketing.channel_attribution':
        return this.channelAttribution(tenantId);
      case 'marketing.email':
        return this.emailPerformance(tenantId);
      case 'service.first_response':
        return this.firstResponse(tenantId, params);
      case 'service.agent_performance':
        return this.agentPerformance(tenantId, params);
      case 'service.csat':
        return this.csat(tenantId);
      case 'comms.calls':
        return this.calls(tenantId, params);
      case 'comms.omnichannel':
        return this.omnichannel(tenantId, params);
      case 'comms.volume_by_channel':
        return this.volumeByChannel(tenantId, params);
      case 'activity.tasks':
        return this.taskLoad(tenantId);
      default:
        throw new BadRequestException(`Unhandled report: ${key}`);
    }
  }

  // ── Sales ────────────────────────────────────

  private async pipeline(tenantId: string) {
    const [stages, deals] = await Promise.all([
      this.prisma.dealStage.findMany({
        where: { tenantId },
        orderBy: { order: 'asc' },
      }),
      this.prisma.deal.findMany({
        where: { tenantId, status: 'open' },
        select: { stageId: true, value: true },
      }),
    ]);

    const rows = stages.map((stage) => {
      const inStage = deals.filter((d) => d.stageId === stage.id);
      const value = inStage.reduce((sum, d) => sum + Number(d.value), 0);
      return {
        stage: stage.name,
        probability: stage.probability,
        deals: inStage.length,
        value,
      };
    });

    return {
      columns: [
        { key: 'stage', label: 'Stage' },
        { key: 'deals', label: 'Deals', type: 'number' as const },
        { key: 'value', label: 'Value', type: 'money' as const },
        { key: 'probability', label: 'Probability %', type: 'number' as const },
      ],
      rows,
      stats: [
        { label: 'Open deals', value: deals.length },
        {
          label: 'Pipeline value',
          value: rows.reduce((sum, r) => sum + r.value, 0),
        },
      ],
    };
  }

  private async forecast(tenantId: string) {
    const [stages, deals] = await Promise.all([
      this.prisma.dealStage.findMany({ where: { tenantId } }),
      this.prisma.deal.findMany({
        where: { tenantId, status: 'open' },
        select: { stageId: true, value: true, expectedAt: true },
      }),
    ]);

    const byMonth = new Map<
      string,
      { weighted: number; raw: number; deals: number }
    >();

    for (const deal of deals) {
      const probability =
        stages.find((s) => s.id === deal.stageId)?.probability ?? 0;
      // Deals with no expected close date are grouped so they stay visible
      // rather than silently dropping out of the forecast.
      const month = deal.expectedAt
        ? deal.expectedAt.toISOString().slice(0, 7)
        : 'Unscheduled';

      const bucket = byMonth.get(month) ?? { weighted: 0, raw: 0, deals: 0 };
      bucket.raw += Number(deal.value);
      bucket.weighted += (Number(deal.value) * probability) / 100;
      bucket.deals += 1;
      byMonth.set(month, bucket);
    }

    const rows = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        month,
        deals: b.deals,
        value: b.raw,
        weighted: this.round(b.weighted, 0),
      }));

    return {
      columns: [
        { key: 'month', label: 'Expected close' },
        { key: 'deals', label: 'Deals', type: 'number' as const },
        { key: 'value', label: 'Pipeline', type: 'money' as const },
        { key: 'weighted', label: 'Weighted', type: 'money' as const },
      ],
      rows,
      stats: [
        {
          label: 'Weighted forecast',
          value: this.round(
            rows.reduce((sum, r) => sum + r.weighted, 0),
            0,
          ),
        },
      ],
    };
  }

  private async leaderboard(tenantId: string, params: ReportParams) {
    const since = this.since(params.days, 365);
    const [users, deals] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.deal.findMany({
        where: {
          tenantId,
          OR: [{ status: 'open' }, { closedAt: { gte: since } }],
        },
        select: { ownerId: true, status: true, value: true },
      }),
    ]);

    const rows = users
      .map((user) => {
        const mine = deals.filter((d) => d.ownerId === user.id);
        const won = mine.filter((d) => d.status === 'won');
        const open = mine.filter((d) => d.status === 'open');
        return {
          rep: `${user.firstName} ${user.lastName}`,
          won: won.length,
          revenue: won.reduce((sum, d) => sum + Number(d.value), 0),
          openDeals: open.length,
          pipeline: open.reduce((sum, d) => sum + Number(d.value), 0),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return {
      columns: [
        { key: 'rep', label: 'Rep' },
        { key: 'revenue', label: 'Won revenue', type: 'money' as const },
        { key: 'won', label: 'Deals won', type: 'number' as const },
        { key: 'pipeline', label: 'Open pipeline', type: 'money' as const },
        { key: 'openDeals', label: 'Open deals', type: 'number' as const },
      ],
      rows,
    };
  }

  private async winLoss(tenantId: string, params: ReportParams) {
    const since = this.since(params.days, 365);
    const closed = await this.prisma.deal.findMany({
      where: {
        tenantId,
        status: { in: ['won', 'lost'] },
        closedAt: { gte: since },
      },
      select: { status: true, value: true },
    });

    const won = closed.filter((d) => d.status === 'won');
    const lost = closed.filter((d) => d.status === 'lost');

    const rows = [
      {
        outcome: 'Won',
        deals: won.length,
        value: won.reduce((s, d) => s + Number(d.value), 0),
      },
      {
        outcome: 'Lost',
        deals: lost.length,
        value: lost.reduce((s, d) => s + Number(d.value), 0),
      },
    ];

    return {
      columns: [
        { key: 'outcome', label: 'Outcome' },
        { key: 'deals', label: 'Deals', type: 'number' as const },
        { key: 'value', label: 'Value', type: 'money' as const },
      ],
      rows,
      stats: [
        {
          label: 'Win rate',
          value: closed.length
            ? `${Math.round((won.length / closed.length) * 100)}%`
            : '—',
        },
        { label: 'Deals closed', value: closed.length },
      ],
    };
  }

  private async salesCycle(tenantId: string, params: ReportParams) {
    const since = this.since(params.days, 365);
    const closed = await this.prisma.deal.findMany({
      where: {
        tenantId,
        status: { in: ['won', 'lost'] },
        closedAt: { gte: since, not: null },
      },
      select: { status: true, createdAt: true, closedAt: true },
    });

    const days = (from: Date, to: Date) =>
      (to.getTime() - from.getTime()) / DAY_MS;

    const build = (status: string) => {
      const set = closed.filter((d) => d.status === status);
      if (!set.length)
        return { outcome: status, deals: 0, avgDays: 0, medianDays: 0 };
      const lengths = set
        .map((d) => days(d.createdAt, d.closedAt!))
        .sort((a, b) => a - b);
      return {
        outcome: status,
        deals: set.length,
        avgDays: this.round(
          lengths.reduce((a, b) => a + b, 0) / lengths.length,
        ),
        medianDays: this.round(lengths[Math.floor(lengths.length / 2)]),
      };
    };

    return {
      columns: [
        { key: 'outcome', label: 'Outcome' },
        { key: 'deals', label: 'Deals', type: 'number' as const },
        { key: 'avgDays', label: 'Avg days', type: 'number' as const },
        { key: 'medianDays', label: 'Median days', type: 'number' as const },
      ],
      rows: [build('won'), build('lost')],
    };
  }

  // ── Marketing ────────────────────────────────

  private async campaigns(tenantId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { recipients: true },
    });

    const rows = campaigns.map((c) => {
      const sent = c.recipients.filter((r) => r.status === 'sent').length;
      const opened = c.recipients.filter((r) => r.openedAt).length;
      const clicked = c.recipients.filter((r) => r.clickedAt).length;
      return {
        campaign: c.name,
        channel: c.channel,
        sent,
        skipped: c.recipients.filter((r) => r.status === 'skipped').length,
        failed: c.recipients.filter((r) => r.status === 'failed').length,
        opened,
        clicked,
        openRate: sent ? Math.round((opened / sent) * 100) : 0,
      };
    });

    return {
      columns: [
        { key: 'campaign', label: 'Campaign' },
        { key: 'channel', label: 'Channel' },
        { key: 'sent', label: 'Sent', type: 'number' as const },
        { key: 'opened', label: 'Opened', type: 'number' as const },
        { key: 'clicked', label: 'Clicked', type: 'number' as const },
        { key: 'openRate', label: 'Open rate %', type: 'number' as const },
        { key: 'skipped', label: 'Skipped', type: 'number' as const },
        { key: 'failed', label: 'Failed', type: 'number' as const },
      ],
      rows,
    };
  }

  private async channelAttribution(tenantId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { tenantId },
      select: {
        channel: true,
        contactId: true,
        _count: { select: { messages: true } },
      },
    });

    const byChannel = new Map<
      string,
      { conversations: number; messages: number; contacts: Set<string> }
    >();

    for (const c of conversations) {
      const bucket = byChannel.get(c.channel) ?? {
        conversations: 0,
        messages: 0,
        contacts: new Set<string>(),
      };
      bucket.conversations += 1;
      bucket.messages += c._count.messages;
      if (c.contactId) bucket.contacts.add(c.contactId);
      byChannel.set(c.channel, bucket);
    }

    const rows = [...byChannel.entries()]
      .map(([channel, b]) => ({
        channel,
        conversations: b.conversations,
        messages: b.messages,
        contacts: b.contacts.size,
      }))
      .sort((a, b) => b.conversations - a.conversations);

    return {
      columns: [
        { key: 'channel', label: 'Channel' },
        {
          key: 'conversations',
          label: 'Conversations',
          type: 'number' as const,
        },
        { key: 'messages', label: 'Messages', type: 'number' as const },
        { key: 'contacts', label: 'Contacts reached', type: 'number' as const },
      ],
      rows,
    };
  }

  private async emailPerformance(tenantId: string) {
    const [sent, opens, clicks] = await Promise.all([
      this.prisma.message.count({
        where: {
          tenantId,
          channel: Channel.EMAIL,
          direction: MessageDirection.OUTBOUND,
        },
      }),
      this.prisma.emailEvent.groupBy({
        by: ['messageId'],
        where: { tenantId, type: 'open' },
      }),
      this.prisma.emailEvent.groupBy({
        by: ['messageId'],
        where: { tenantId, type: 'click' },
      }),
    ]);

    const replies = await this.prisma.message.count({
      where: {
        tenantId,
        channel: Channel.EMAIL,
        direction: MessageDirection.INBOUND,
      },
    });

    const rows = [
      { metric: 'Sent', count: sent, rate: 100 },
      {
        metric: 'Opened',
        count: opens.length,
        rate: sent ? Math.round((opens.length / sent) * 100) : 0,
      },
      {
        metric: 'Clicked',
        count: clicks.length,
        rate: sent ? Math.round((clicks.length / sent) * 100) : 0,
      },
      {
        metric: 'Replied',
        count: replies,
        rate: sent ? Math.round((replies / sent) * 100) : 0,
      },
    ];

    return {
      columns: [
        { key: 'metric', label: 'Metric' },
        { key: 'count', label: 'Count', type: 'number' as const },
        { key: 'rate', label: 'Rate %', type: 'number' as const },
      ],
      rows,
      stats: [
        { label: 'Emails sent', value: sent },
        {
          label: 'Open rate',
          value: sent ? `${Math.round((opens.length / sent) * 100)}%` : '—',
        },
      ],
    };
  }

  // ── Service ──────────────────────────────────

  /**
   * First-response times, in minutes, for conversations the customer started.
   *
   * Measured from the customer's first message rather than the conversation
   * row: an outbound-initiated thread has nothing to respond to, and a thread
   * whose messages were backfilled can carry a firstResponseAt that precedes
   * the row itself. Both would otherwise land in the average - as a
   * meaningless zero, or as a negative.
   */
  private async responseTimes(tenantId: string, since: Date) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        firstResponseAt: { not: null },
        messages: { some: { createdAt: { gte: since } } },
      },
      select: {
        channel: true,
        assignedToId: true,
        firstResponseAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { direction: true, createdAt: true },
        },
      },
    });

    return conversations.flatMap((c) => {
      const first = c.messages[0];
      if (!first || first.direction !== MessageDirection.INBOUND) return [];
      const minutes =
        (c.firstResponseAt!.getTime() - first.createdAt.getTime()) / 60000;
      if (minutes < 0) return [];
      return [{ channel: c.channel, agentId: c.assignedToId, minutes }];
    });
  }

  private async firstResponse(tenantId: string, params: ReportParams) {
    const since = this.since(params.days, 30);
    const slaMinutes =
      this.config.get<number>('reports.slaFirstResponseMinutes') ?? 60;

    const measured = await this.responseTimes(tenantId, since);

    const byChannel = new Map<string, number[]>();
    for (const m of measured) {
      byChannel.set(m.channel, [
        ...(byChannel.get(m.channel) ?? []),
        m.minutes,
      ]);
    }

    const rows = [...byChannel.entries()].map(([channel, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const withinSla = values.filter((v) => v <= slaMinutes).length;
      return {
        channel,
        conversations: values.length,
        avgMinutes: this.round(
          values.reduce((a, b) => a + b, 0) / values.length,
        ),
        medianMinutes: this.round(sorted[Math.floor(sorted.length / 2)]),
        slaPercent: Math.round((withinSla / values.length) * 100),
      };
    });

    const all = [...byChannel.values()].flat();

    return {
      columns: [
        { key: 'channel', label: 'Channel' },
        {
          key: 'conversations',
          label: 'Conversations',
          type: 'number' as const,
        },
        { key: 'avgMinutes', label: 'Avg minutes', type: 'number' as const },
        {
          key: 'medianMinutes',
          label: 'Median minutes',
          type: 'number' as const,
        },
        {
          key: 'slaPercent',
          label: `Within ${slaMinutes}m %`,
          type: 'number' as const,
        },
      ],
      rows,
      stats: [
        {
          label: 'Overall avg',
          value: all.length
            ? `${this.round(all.reduce((a, b) => a + b, 0) / all.length)} min`
            : '—',
        },
        {
          label: `SLA (${slaMinutes}m)`,
          value: all.length
            ? `${Math.round((all.filter((v) => v <= slaMinutes).length / all.length) * 100)}%`
            : '—',
        },
      ],
    };
  }

  private async agentPerformance(tenantId: string, params: ReportParams) {
    const since = this.since(params.days, 30);

    const [users, conversations, responseTimes, calls, tasks] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, firstName: true, lastName: true },
        }),
        this.prisma.conversation.findMany({
          where: {
            tenantId,
            assignedToId: { not: null },
            createdAt: { gte: since },
          },
          select: { assignedToId: true },
        }),
        this.responseTimes(tenantId, since),
        this.prisma.call.findMany({
          where: {
            tenantId,
            agentId: { not: null },
            startedAt: { gte: since },
          },
          select: { agentId: true, durationSec: true },
        }),
        this.prisma.task.findMany({
          where: {
            tenantId,
            assigneeId: { not: null },
            createdAt: { gte: since },
          },
          select: { assigneeId: true, status: true },
        }),
      ]);

    const rows = users
      .map((user) => {
        const mine = conversations.filter((c) => c.assignedToId === user.id);
        const responseMinutes = responseTimes
          .filter((r) => r.agentId === user.id)
          .map((r) => r.minutes);
        const myCalls = calls.filter((c) => c.agentId === user.id);
        const myTasks = tasks.filter((t) => t.assigneeId === user.id);

        return {
          agent: `${user.firstName} ${user.lastName}`,
          conversations: mine.length,
          avgResponseMinutes: responseMinutes.length
            ? this.round(
                responseMinutes.reduce((a, b) => a + b, 0) /
                  responseMinutes.length,
              )
            : 0,
          calls: myCalls.length,
          talkTimeMin: this.round(
            myCalls.reduce((s, c) => s + c.durationSec, 0) / 60,
          ),
          tasksDone: myTasks.filter((t) => t.status === 'done').length,
        };
      })
      .sort((a, b) => b.conversations - a.conversations);

    return {
      columns: [
        { key: 'agent', label: 'Agent' },
        {
          key: 'conversations',
          label: 'Conversations',
          type: 'number' as const,
        },
        {
          key: 'avgResponseMinutes',
          label: 'Avg response (min)',
          type: 'number' as const,
        },
        { key: 'calls', label: 'Calls', type: 'number' as const },
        {
          key: 'talkTimeMin',
          label: 'Talk time (min)',
          type: 'number' as const,
        },
        { key: 'tasksDone', label: 'Tasks done', type: 'number' as const },
      ],
      rows,
    };
  }

  private async csat(tenantId: string) {
    const rated = await this.prisma.conversation.findMany({
      where: { tenantId, rating: { not: null } },
      select: { rating: true },
    });

    const rows = [5, 4, 3, 2, 1].map((score) => ({
      rating: `${score} star`,
      count: rated.filter((r) => r.rating === score).length,
    }));

    const total = rated.length;
    const average = total
      ? this.round(rated.reduce((s, r) => s + (r.rating ?? 0), 0) / total)
      : 0;
    // Promoters minus detractors, on the 1-5 scale chats are rated on.
    const promoters = rated.filter((r) => (r.rating ?? 0) >= 4).length;
    const detractors = rated.filter((r) => (r.rating ?? 0) <= 2).length;

    return {
      columns: [
        { key: 'rating', label: 'Rating' },
        { key: 'count', label: 'Responses', type: 'number' as const },
      ],
      rows,
      stats: [
        { label: 'Responses', value: total },
        { label: 'Average', value: total ? `${average} / 5` : '—' },
        {
          label: 'NPS-style score',
          value: total
            ? Math.round(((promoters - detractors) / total) * 100)
            : '—',
        },
      ],
    };
  }

  // ── Communication ────────────────────────────

  private async calls(tenantId: string, params: ReportParams) {
    const since = this.since(params.days, 30);
    const calls = await this.prisma.call.findMany({
      where: { tenantId, startedAt: { gte: since } },
      select: { status: true, direction: true, durationSec: true },
    });

    const count = (status: CallStatus) =>
      calls.filter((c) => c.status === status).length;

    const answered =
      count(CallStatus.COMPLETED) + count(CallStatus.IN_PROGRESS);
    const missed =
      count(CallStatus.MISSED) +
      count(CallStatus.BUSY) +
      count(CallStatus.FAILED);

    const rows = [
      { outcome: 'Answered', calls: answered },
      { outcome: 'Missed', calls: missed },
      { outcome: 'Voicemail', calls: count(CallStatus.VOICEMAIL) },
    ];

    const talkTime = calls.reduce((s, c) => s + c.durationSec, 0);

    return {
      columns: [
        { key: 'outcome', label: 'Outcome' },
        { key: 'calls', label: 'Calls', type: 'number' as const },
      ],
      rows,
      stats: [
        { label: 'Total calls', value: calls.length },
        {
          label: 'Answer rate',
          value: calls.length
            ? `${Math.round((answered / calls.length) * 100)}%`
            : '—',
        },
        { label: 'Talk time', value: `${Math.round(talkTime / 60)} min` },
        {
          label: 'Inbound',
          value: calls.filter((c) => c.direction === CallDirection.INBOUND)
            .length,
        },
      ],
    };
  }

  private async omnichannel(tenantId: string, params: ReportParams) {
    const days = params.days ?? 14;
    const since = this.since(days, 14);

    const messages = await this.prisma.message.findMany({
      where: { tenantId, createdAt: { gte: since }, isInternal: false },
      select: { channel: true, direction: true, createdAt: true },
    });

    const channels = [...new Set(messages.map((m) => m.channel))].sort();
    const byDay = new Map<string, Record<string, number>>();

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
      byDay.set(
        day,
        Object.fromEntries([
          ['inbound', 0],
          ['outbound', 0],
          ...channels.map((c) => [c, 0]),
        ]) as Record<string, number>,
      );
    }

    for (const m of messages) {
      const day = m.createdAt.toISOString().slice(0, 10);
      const bucket = byDay.get(day);
      if (!bucket) continue;
      bucket[m.channel] = (bucket[m.channel] ?? 0) + 1;
      bucket[
        m.direction === MessageDirection.INBOUND ? 'inbound' : 'outbound'
      ] += 1;
    }

    return {
      columns: [
        { key: 'day', label: 'Day' },
        { key: 'inbound', label: 'Inbound', type: 'number' as const },
        { key: 'outbound', label: 'Outbound', type: 'number' as const },
        ...channels.map((c) => ({
          key: c,
          label: c,
          type: 'number' as const,
        })),
      ],
      rows: [...byDay.entries()].map(([day, counts]) => ({ day, ...counts })),
      stats: [{ label: 'Messages', value: messages.length }],
    };
  }

  private async volumeByChannel(tenantId: string, params: ReportParams) {
    const since = this.since(params.days, 30);
    const grouped = await this.prisma.message.groupBy({
      by: ['channel', 'direction'],
      where: { tenantId, createdAt: { gte: since }, isInternal: false },
      _count: { _all: true },
    });

    const channels = [...new Set(grouped.map((g) => g.channel))];
    const rows = channels
      .map((channel) => {
        const inbound =
          grouped.find(
            (g) =>
              g.channel === channel && g.direction === MessageDirection.INBOUND,
          )?._count._all ?? 0;
        const outbound =
          grouped.find(
            (g) =>
              g.channel === channel &&
              g.direction === MessageDirection.OUTBOUND,
          )?._count._all ?? 0;
        return { channel, inbound, outbound, total: inbound + outbound };
      })
      .sort((a, b) => b.total - a.total);

    return {
      columns: [
        { key: 'channel', label: 'Channel' },
        { key: 'total', label: 'Messages', type: 'number' as const },
        { key: 'inbound', label: 'Inbound', type: 'number' as const },
        { key: 'outbound', label: 'Outbound', type: 'number' as const },
      ],
      rows,
    };
  }

  // ── Activity ─────────────────────────────────

  private async taskLoad(tenantId: string) {
    const [users, tasks] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.task.findMany({
        where: { tenantId },
        select: { assigneeId: true, status: true, dueAt: true },
      }),
    ]);

    const now = new Date();
    const rows = users
      .map((user) => {
        const mine = tasks.filter((t) => t.assigneeId === user.id);
        const open = mine.filter((t) => t.status !== 'done');
        return {
          assignee: `${user.firstName} ${user.lastName}`,
          open: open.length,
          overdue: open.filter((t) => t.dueAt && t.dueAt < now).length,
          done: mine.filter((t) => t.status === 'done').length,
        };
      })
      .sort((a, b) => b.open - a.open);

    const unassigned = tasks.filter((t) => !t.assigneeId);
    if (unassigned.length) {
      rows.push({
        assignee: 'Unassigned',
        open: unassigned.filter((t) => t.status !== 'done').length,
        overdue: unassigned.filter(
          (t) => t.status !== 'done' && t.dueAt && t.dueAt < now,
        ).length,
        done: unassigned.filter((t) => t.status === 'done').length,
      });
    }

    return {
      columns: [
        { key: 'assignee', label: 'Assignee' },
        { key: 'open', label: 'Open', type: 'number' as const },
        { key: 'overdue', label: 'Overdue', type: 'number' as const },
        { key: 'done', label: 'Done', type: 'number' as const },
      ],
      rows,
    };
  }

  // ── Export ───────────────────────────────────

  /** RFC 4180 style CSV of a report's table. */
  toCsv(report: ReportResult): string {
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const header = report.columns.map((c) => escape(c.label)).join(',');
    const lines = report.rows.map((row) =>
      report.columns.map((c) => escape(row[c.key])).join(','),
    );
    return [header, ...lines].join('\n');
  }
}
