import { Injectable } from '@nestjs/common';
import { CallStatus, Channel, MessageDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ScoreFactor {
  label: string;
  /** Points this signal contributed, positive or negative */
  impact: number;
  detail: string;
}

export interface LeadSignals {
  score: number;
  label: 'hot' | 'warm' | 'cold';
  factors: ScoreFactor[];
  /** Facts handed to the model so it can write the explanation */
  context: Record<string, unknown>;
}

export interface DealSignals {
  probability: number;
  label: 'healthy' | 'watch' | 'at_risk';
  factors: ScoreFactor[];
  context: Record<string, unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turns CRM history into the numbers the AI layer explains.
 *
 * Deliberately deterministic: the score comes from what the contact actually
 * did, so it is identical with or without an AI provider, reproducible, and
 * defensible to the rep whose commission depends on it. The model never
 * invents the number - it only puts it into words.
 */
@Injectable()
export class SignalsService {
  constructor(private readonly prisma: PrismaService) {}

  private daysSince(date: Date | null | undefined): number | null {
    if (!date) return null;
    return Math.floor((Date.now() - date.getTime()) / DAY_MS);
  }

  private clamp(n: number, min = 0, max = 100): number {
    return Math.max(min, Math.min(max, n));
  }

  /** Which channel this contact actually replies on, and how quickly. */
  async engagementByChannel(tenantId: string, contactId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { tenantId, contactId },
      select: {
        channel: true,
        messages: {
          select: { direction: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return conversations
      .map((c) => {
        const inbound = c.messages.filter(
          (m) => m.direction === MessageDirection.INBOUND,
        );
        return {
          channel: c.channel,
          inbound: inbound.length,
          outbound: c.messages.length - inbound.length,
          lastInboundAt: inbound.at(-1)?.createdAt ?? null,
        };
      })
      .sort((a, b) => b.inbound - a.inbound);
  }

  /**
   * The hour of day this contact usually replies in, from their own inbound
   * messages. Null when there is not enough history to say anything.
   */
  async bestContactHour(
    tenantId: string,
    contactId: string,
  ): Promise<number | null> {
    const inbound = await this.prisma.message.findMany({
      where: {
        tenantId,
        direction: MessageDirection.INBOUND,
        conversation: { contactId },
      },
      select: { createdAt: true },
      take: 200,
    });

    if (inbound.length < 3) return null;

    const hours = new Map<number, number>();
    for (const m of inbound) {
      const hour = m.createdAt.getHours();
      hours.set(hour, (hours.get(hour) ?? 0) + 1);
    }
    return [...hours.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  /** Lead score from engagement, fit and recency. */
  async scoreLead(tenantId: string, contactId: string): Promise<LeadSignals> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenantId },
      include: { company: true, deals: true },
    });
    if (!contact) throw new Error('Contact not found');

    const [engagement, opens, calls] = await Promise.all([
      this.engagementByChannel(tenantId, contactId),
      this.prisma.emailEvent.count({
        where: {
          tenantId,
          type: 'open',
          message: { conversation: { contactId } },
        },
      }),
      this.prisma.call.findMany({
        where: { tenantId, contactId },
        select: { status: true, durationSec: true, startedAt: true },
      }),
    ]);

    const inboundTotal = engagement.reduce((sum, e) => sum + e.inbound, 0);
    const lastInbound = engagement
      .map((e) => e.lastInboundAt)
      .filter(Boolean)
      .sort((a, b) => b!.getTime() - a!.getTime())[0];
    const daysSinceReply = this.daysSince(lastInbound);
    const answeredCalls = calls.filter(
      (c) => c.status === CallStatus.COMPLETED,
    ).length;
    const openDeals = contact.deals.filter((d) => d.status === 'open');
    const dealValue = openDeals.reduce((sum, d) => sum + Number(d.value), 0);

    const factors: ScoreFactor[] = [];
    const add = (label: string, impact: number, detail: string) => {
      if (impact !== 0) factors.push({ label, impact, detail });
    };

    // Replies are the strongest signal of interest.
    add(
      'Replies received',
      Math.min(inboundTotal * 8, 32),
      `${inboundTotal} inbound message(s)`,
    );
    add(
      'Answered a call',
      Math.min(answeredCalls * 12, 24),
      `${answeredCalls} call(s) answered`,
    );
    add('Email opens', Math.min(opens * 4, 12), `${opens} open(s)`);

    if (openDeals.length) {
      add(
        'Open opportunity',
        Math.min(10 + Math.floor(dealValue / 200000), 20),
        `${openDeals.length} open deal(s) worth ${dealValue}`,
      );
    }

    // Seniority in the title is a rough but real fit signal.
    const title = (contact.jobTitle ?? '').toLowerCase();
    if (/(head|chief|director|vp|founder|owner|ceo|cto|manager)/.test(title)) {
      add('Decision-maker title', 10, contact.jobTitle ?? '');
    }
    if (contact.company) add('Linked to a company', 5, contact.company.name);

    // Going quiet pulls the score back down.
    if (daysSinceReply !== null && daysSinceReply > 30) {
      add('Gone quiet', -15, `${daysSinceReply} days since their last reply`);
    } else if (daysSinceReply === null && inboundTotal === 0) {
      add('Never replied', -10, 'No inbound message on any channel');
    }

    const score = this.clamp(factors.reduce((sum, f) => sum + f.impact, 0));

    return {
      score,
      label: score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold',
      factors,
      context: {
        name: `${contact.firstName} ${contact.lastName}`,
        jobTitle: contact.jobTitle,
        company: contact.company?.name,
        inboundMessages: inboundTotal,
        emailOpens: opens,
        answeredCalls,
        openDeals: openDeals.length,
        dealValue,
        daysSinceReply,
        channels: engagement,
      },
    };
  }

  /** Win probability from stage, momentum and engagement. */
  async scoreDeal(tenantId: string, dealId: string): Promise<DealSignals> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId },
      include: { stage: true, contact: true },
    });
    if (!deal) throw new Error('Deal not found');

    const [activities, messages] = await Promise.all([
      this.prisma.activity.findMany({
        where: { tenantId, dealId },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
      deal.contactId
        ? this.prisma.message.findMany({
            where: {
              tenantId,
              direction: MessageDirection.INBOUND,
              conversation: { contactId: deal.contactId },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          })
        : Promise.resolve([]),
    ]);

    const ageDays = this.daysSince(deal.createdAt) ?? 0;
    const daysSinceActivity = this.daysSince(activities[0]?.createdAt);
    const daysSinceReply = this.daysSince(messages[0]?.createdAt);
    const daysToExpected = deal.expectedAt
      ? Math.floor((deal.expectedAt.getTime() - Date.now()) / DAY_MS)
      : null;

    const factors: ScoreFactor[] = [];
    const add = (label: string, impact: number, detail: string) => {
      if (impact !== 0) factors.push({ label, impact, detail });
    };

    // The pipeline stage is the baseline everything else adjusts.
    add(
      'Pipeline stage',
      deal.stage.probability,
      `${deal.stage.name} (${deal.stage.probability}%)`,
    );

    if (daysSinceReply !== null && daysSinceReply <= 7) {
      add('Recent reply from the contact', 10, `${daysSinceReply} day(s) ago`);
    }
    if (daysSinceActivity !== null && daysSinceActivity > 21) {
      add('No activity logged', -15, `${daysSinceActivity} days of silence`);
    }
    if (daysSinceReply !== null && daysSinceReply > 30) {
      add(
        'Contact has gone quiet',
        -15,
        `${daysSinceReply} days since a reply`,
      );
    }
    if (ageDays > 90) {
      add('Deal is ageing', -10, `open for ${ageDays} days`);
    }
    if (daysToExpected !== null && daysToExpected < 0) {
      add(
        'Past its expected close date',
        -15,
        `${Math.abs(daysToExpected)} days overdue`,
      );
    }
    if (!deal.ownerId) add('No owner', -10, 'Nobody is driving this deal');

    const probability = this.clamp(
      factors.reduce((sum, f) => sum + f.impact, 0),
    );

    return {
      probability,
      label:
        probability >= 60 ? 'healthy' : probability >= 30 ? 'watch' : 'at_risk',
      factors,
      context: {
        title: deal.title,
        stage: deal.stage.name,
        value: Number(deal.value),
        currency: deal.currency,
        ageDays,
        daysSinceActivity,
        daysSinceReply,
        daysToExpected,
        contact: deal.contact
          ? `${deal.contact.firstName} ${deal.contact.lastName}`
          : null,
      },
    };
  }

  /** Everything worth knowing about a contact, for the research assistant. */
  async contactDossier(tenantId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenantId },
      include: { company: true, deals: { include: { stage: true } } },
    });
    if (!contact) throw new Error('Contact not found');

    const [engagement, recentMessages, calls] = await Promise.all([
      this.engagementByChannel(tenantId, contactId),
      this.prisma.message.findMany({
        where: { tenantId, isInternal: false, conversation: { contactId } },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { direction: true, channel: true, body: true, createdAt: true },
      }),
      this.prisma.call.count({ where: { tenantId, contactId } }),
    ]);

    return {
      name: `${contact.firstName} ${contact.lastName}`,
      jobTitle: contact.jobTitle,
      company: contact.company?.name,
      email: contact.email,
      phone: contact.phone,
      score: contact.score,
      openDeals: contact.deals.filter((d) => d.status === 'open').length,
      deals: contact.deals.map((d) => ({
        title: d.title,
        stage: d.stage.name,
        value: Number(d.value),
        status: d.status,
      })),
      calls,
      channels: engagement,
      messageCount: engagement.reduce(
        (sum, e) => sum + e.inbound + e.outbound,
        0,
      ),
      recentMessages: recentMessages.reverse().map((m) => ({
        direction: m.direction,
        channel: m.channel,
        body: (m.body ?? '').slice(0, 300),
        at: m.createdAt.toISOString(),
      })),
    };
  }

  /** The messages of one conversation, for sentiment and reply drafting. */
  async conversationTranscript(tenantId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        contact: true,
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          take: 40,
          select: { direction: true, body: true, createdAt: true },
        },
      },
    });
    if (!conversation) throw new Error('Conversation not found');

    const lastInbound = [...conversation.messages]
      .reverse()
      .find((m) => m.direction === MessageDirection.INBOUND);

    return {
      channel: conversation.channel as Channel,
      // Null rather than the phone number: a draft greeting an unknown caller
      // by their raw number reads worse than a neutral "Hi there".
      contactName: conversation.contact
        ? `${conversation.contact.firstName} ${conversation.contact.lastName}`
        : null,
      externalId: conversation.externalId,
      contactId: conversation.contactId,
      lastInboundMessage: lastInbound?.body ?? '',
      transcript: conversation.messages
        .map(
          (m) =>
            `${m.direction === MessageDirection.INBOUND ? 'Customer' : 'Agent'}: ${m.body ?? ''}`,
        )
        .join('\n'),
    };
  }
}
