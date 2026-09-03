import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionQueryDto } from './dto/marketing.dto';

export type AttributionModel = 'first' | 'last' | 'linear';

interface Touch {
  key: string;
  label: string;
  occurredAt: Date;
}

/**
 * Splits one deal's value across the touches that led to it.
 *
 * Three models rather than one, because they disagree and the disagreement is
 * the useful part: first-touch flatters whatever fills the top of the funnel,
 * last-touch flatters whatever closes, and linear refuses to choose.
 */
export function splitCredit(
  touches: Touch[],
  value: number,
  model: AttributionModel,
): Map<string, number> {
  const credit = new Map<string, number>();
  if (touches.length === 0 || value === 0) return credit;

  const ordered = [...touches].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  const give = (key: string, amount: number) =>
    credit.set(key, (credit.get(key) ?? 0) + amount);

  if (model === 'first') give(ordered[0].key, value);
  else if (model === 'last') give(ordered[ordered.length - 1].key, value);
  else {
    const share = value / ordered.length;
    for (const touch of ordered) give(touch.key, share);
  }

  return credit;
}

@Injectable()
export class AttributionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Which campaigns and pages the won revenue can be traced back to.
   *
   * Only won deals count. Crediting a channel for pipeline it has not closed
   * yet is how a marketing report ends up disagreeing with the finance one.
   * Deals no touch can explain are reported as uncredited rather than dropped,
   * so the total always matches what was actually won.
   */
  async revenue(tenantId: string, query: AttributionQueryDto) {
    const model = (query.model ?? 'linear') as AttributionModel;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    // Every won deal, not only the ones with a contact: a deal that cannot be
    // traced still happened, and leaving it out would quietly shrink the
    // revenue this report claims to be splitting up.
    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        status: 'won',
        ...(from || to
          ? {
              closedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: to } : {}),
              },
            }
          : {}),
      },
      select: { id: true, value: true, contactId: true, closedAt: true },
    });

    const contactIds = deals
      .map((d) => d.contactId)
      .filter((id): id is string => Boolean(id));

    const touchpoints = contactIds.length
      ? await this.prisma.touchpoint.findMany({
          where: { tenantId, contactId: { in: contactIds } },
          include: {
            campaign: { select: { id: true, name: true } },
            page: { select: { id: true, title: true } },
          },
        })
      : [];

    const byContact = new Map<string, Touch[]>();
    for (const tp of touchpoints) {
      if (!tp.contactId) continue;
      // A touch that names neither a campaign nor a page cannot be credited to
      // anything, so it is left out rather than lumped into an "other" bucket
      // that would quietly absorb the revenue.
      const key = tp.campaignId
        ? `campaign:${tp.campaignId}`
        : tp.pageId
          ? `page:${tp.pageId}`
          : null;
      if (!key) continue;

      const label = tp.campaign?.name ?? tp.page?.title ?? 'Unknown';
      byContact.set(tp.contactId, [
        ...(byContact.get(tp.contactId) ?? []),
        { key, label, occurredAt: tp.occurredAt },
      ]);
    }

    const totals = new Map<
      string,
      { label: string; revenue: number; deals: number }
    >();
    let credited = 0;
    let uncredited = 0;

    for (const deal of deals) {
      const touches = deal.contactId
        ? byContact.get(deal.contactId)
        : undefined;
      const value = Number(deal.value);
      if (!touches?.length) {
        // Deals that no marketing touch can be traced to. Reporting this
        // number is the difference between attribution and wishful thinking.
        uncredited += value;
        continue;
      }

      credited += value;
      const split = splitCredit(touches, value, model);
      for (const [key, amount] of split) {
        const label = touches.find((t) => t.key === key)?.label ?? 'Unknown';
        const row = totals.get(key) ?? { label, revenue: 0, deals: 0 };
        row.revenue += amount;
        row.deals += 1;
        totals.set(key, row);
      }
    }

    return {
      model,
      wonRevenue: credited + uncredited,
      creditedRevenue: Math.round(credited),
      uncreditedRevenue: Math.round(uncredited),
      rows: [...totals.entries()]
        .map(([key, row]) => ({
          key,
          kind: key.startsWith('campaign:') ? 'campaign' : 'page',
          label: row.label,
          revenue: Math.round(row.revenue),
          deals: row.deals,
        }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  }

  /**
   * What each campaign cost against what it brought in.
   *
   * Revenue is taken from the same attribution split, so ROI and the
   * attribution table can never tell two different stories.
   */
  async campaignRoi(tenantId: string, query: AttributionQueryDto) {
    const attributed = await this.revenue(tenantId, query);
    const byKey = new Map(attributed.rows.map((r) => [r.key, r]));

    const campaigns = await this.prisma.campaign.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
        cost: true,
        currency: true,
        _count: { select: { recipients: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const sent = await this.prisma.campaignRecipient.groupBy({
      by: ['campaignId'],
      where: { tenantId, status: 'sent' },
      _count: { _all: true },
    });
    const opened = await this.prisma.campaignRecipient.groupBy({
      by: ['campaignId'],
      where: { tenantId, openedAt: { not: null } },
      _count: { _all: true },
    });
    const clicked = await this.prisma.campaignRecipient.groupBy({
      by: ['campaignId'],
      where: { tenantId, clickedAt: { not: null } },
      _count: { _all: true },
    });

    const countOf = (
      rows: { campaignId: string; _count: { _all: number } }[],
      id: string,
    ) => rows.find((r) => r.campaignId === id)?._count._all ?? 0;

    return {
      model: attributed.model,
      rows: campaigns.map((c) => {
        const revenue = byKey.get(`campaign:${c.id}`)?.revenue ?? 0;
        const cost = Number(c.cost);
        const sentCount = countOf(sent, c.id);
        return {
          id: c.id,
          name: c.name,
          channel: c.channel,
          status: c.status,
          cost,
          currency: c.currency,
          audience: c._count.recipients,
          sent: sentCount,
          opened: countOf(opened, c.id),
          clicked: countOf(clicked, c.id),
          revenue,
          // Return on spend, as a percentage of the spend. Null rather than
          // infinity when nothing was spent: a free campaign has no ROI, it
          // just has revenue.
          roi: cost > 0 ? Math.round(((revenue - cost) / cost) * 100) : null,
          costPerSend: sentCount ? Math.round(cost / sentCount) : null,
        };
      }),
    };
  }

  /**
   * The funnel, from first touch to won.
   *
   * Each step counts people, not events, so somebody who opened five emails
   * is one person who opened.
   */
  async funnel(tenantId: string) {
    const [leads, engaged, qualified, converted, won] = await Promise.all([
      this.prisma.lead.count({ where: { tenantId } }),
      this.prisma.lead.count({
        where: { tenantId, touchpoints: { some: {} } },
      }),
      this.prisma.lead.count({
        where: { tenantId, status: { in: ['QUALIFIED', 'CONVERTED'] } },
      }),
      this.prisma.lead.count({ where: { tenantId, status: 'CONVERTED' } }),
      this.prisma.lead.count({
        where: {
          tenantId,
          status: 'CONVERTED',
          convertedDealId: { not: null },
        },
      }),
    ]);

    const steps = [
      { step: 'Leads', count: leads },
      { step: 'Engaged', count: engaged },
      { step: 'Qualified', count: qualified },
      { step: 'Converted to contact', count: converted },
      { step: 'Opened a deal', count: won },
    ];

    return steps.map((s, i) => ({
      ...s,
      // Against the top of the funnel, which is the only figure that does not
      // change meaning as steps are added or removed.
      ofTotal: leads ? Math.round((s.count / leads) * 100) : 0,
      dropOff:
        i === 0 || steps[i - 1].count === 0
          ? 0
          : Math.round((1 - s.count / steps[i - 1].count) * 100),
    }));
  }

  /** Where leads come from, and which sources actually turn into customers. */
  async sources(tenantId: string) {
    const leads = await this.prisma.lead.groupBy({
      by: ['source'],
      where: { tenantId },
      _count: { _all: true },
      _avg: { score: true },
    });

    const convertedRows = await this.prisma.lead.groupBy({
      by: ['source'],
      where: { tenantId, status: 'CONVERTED' },
      _count: { _all: true },
    });

    return leads
      .map((row) => {
        const converted =
          convertedRows.find((c) => c.source === row.source)?._count._all ?? 0;
        const total = row._count._all;
        return {
          source: row.source ?? 'unknown',
          leads: total,
          converted,
          conversionRate: total ? Math.round((converted / total) * 100) : 0,
          averageScore: Math.round(row._avg.score ?? 0),
        };
      })
      .sort((a, b) => b.leads - a.leads);
  }
}
