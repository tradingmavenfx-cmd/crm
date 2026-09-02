import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InsightType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { REPORTS } from '../reports/report-registry';
import { SignalsService, ScoreFactor } from './signals.service';
import { AI_PROVIDER, AiProvider } from './providers/ai-provider.interface';

const SYSTEM = `You are a CRM analyst. You are given structured facts about a
contact, deal or conversation that were computed from the CRM's own data.
Never invent figures: use only the numbers provided. Reply with JSON only,
matching the keys the task asks for. Keep prose to one or two short sentences.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly signals: SignalsService,
    private readonly reports: ReportsService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  /**
   * Asks the model for a JSON object. A provider failure degrades to the
   * fallback rather than failing the request - the numbers are already computed,
   * so losing the prose is not worth a 500.
   */
  private async ask<T extends Record<string, unknown>>(
    facts: Record<string, unknown>,
    fallback: T,
  ): Promise<{ value: T; model: string }> {
    try {
      const result = await this.provider.complete({
        json: true,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(facts) },
        ],
      });
      return {
        value: { ...fallback, ...(JSON.parse(result.text) as T) },
        model: result.model,
      };
    } catch (err) {
      this.logger.warn(
        `AI completion failed (${String(facts.task)}): ${
          err instanceof Error ? err.message : err
        }`,
      );
      return { value: fallback, model: 'unavailable' };
    }
  }

  private saveInsight(data: {
    tenantId: string;
    type: InsightType;
    entityType: string;
    entityId: string;
    score?: number;
    label?: string;
    summary: string;
    factors: ScoreFactor[];
    model: string;
  }) {
    return this.prisma.aiInsight.create({
      data: {
        tenantId: data.tenantId,
        type: data.type,
        entityType: data.entityType,
        entityId: data.entityId,
        score: data.score,
        label: data.label,
        summary: data.summary,
        factors: data.factors as unknown as Prisma.InputJsonValue,
        source: this.provider.name,
        model: data.model,
      },
    });
  }

  // ── Predictive lead scoring ──────────────────

  async scoreContact(tenantId: string, contactId: string) {
    const signals = await this.signals
      .scoreLead(tenantId, contactId)
      .catch(() => null);
    if (!signals) throw new NotFoundException('Contact not found');

    const { value, model } = await this.ask(
      {
        task: 'lead_score',
        score: signals.score,
        band: signals.label,
        factors: signals.factors,
        ...signals.context,
      },
      { summary: `Scored ${signals.score} (${signals.label}).` },
    );

    // The score is the CRM's own; keep the contact record in step with it.
    await this.prisma.contact.updateMany({
      where: { id: contactId, tenantId },
      data: { score: signals.score },
    });

    const insight = await this.saveInsight({
      tenantId,
      type: InsightType.LEAD_SCORE,
      entityType: 'contact',
      entityId: contactId,
      score: signals.score,
      label: signals.label,
      summary: String(value.summary),
      factors: signals.factors,
      model,
    });

    return { ...insight, factors: signals.factors };
  }

  // ── Deal win/loss prediction ─────────────────

  async predictDeal(tenantId: string, dealId: string) {
    const signals = await this.signals
      .scoreDeal(tenantId, dealId)
      .catch(() => null);
    if (!signals) throw new NotFoundException('Deal not found');

    const { value, model } = await this.ask(
      {
        task: 'deal_risk',
        probability: signals.probability,
        band: signals.label,
        factors: signals.factors,
        ...signals.context,
      },
      {
        summary: `Win probability ${signals.probability}% (${signals.label}).`,
      },
    );

    const insight = await this.saveInsight({
      tenantId,
      type: InsightType.DEAL_RISK,
      entityType: 'deal',
      entityId: dealId,
      score: signals.probability,
      label: signals.label,
      summary: String(value.summary),
      factors: signals.factors,
      model,
    });

    return { ...insight, factors: signals.factors };
  }

  /** Open deals the signals say are slipping. */
  async atRiskDeals(tenantId: string) {
    const deals = await this.prisma.deal.findMany({
      where: { tenantId, status: 'open' },
      select: { id: true, title: true },
      take: 100,
    });

    const scored = await Promise.all(
      deals.map(async (deal) => {
        const signals = await this.signals.scoreDeal(tenantId, deal.id);
        return {
          dealId: deal.id,
          title: deal.title,
          probability: signals.probability,
          label: signals.label,
          risks: signals.factors.filter((f) => f.impact < 0),
        };
      }),
    );

    return scored
      .filter((d) => d.label !== 'healthy')
      .sort((a, b) => a.probability - b.probability);
  }

  // ── Sales coach ──────────────────────────────

  async coach(tenantId: string, contactId: string) {
    const [signals, engagement, hour] = await Promise.all([
      this.signals.scoreLead(tenantId, contactId).catch(() => null),
      this.signals.engagementByChannel(tenantId, contactId),
      this.signals.bestContactHour(tenantId, contactId),
    ]);
    if (!signals) throw new NotFoundException('Contact not found');

    // The channel they actually answer on, not the one we prefer.
    const bestChannel = engagement.find((e) => e.inbound > 0)?.channel ?? null;

    const { value, model } = await this.ask(
      {
        task: 'next_action',
        name: signals.context.name,
        score: signals.score,
        bestChannel: bestChannel ?? 'email',
        daysSinceContact: signals.context.daysSinceReply ?? 0,
        openDeals: signals.context.openDeals,
        channels: engagement,
      },
      {
        action: 'Follow up with this contact.',
        reason: bestChannel
          ? `They reply on ${bestChannel}.`
          : 'No reply history yet.',
      },
    );

    const insight = await this.saveInsight({
      tenantId,
      type: InsightType.NEXT_ACTION,
      entityType: 'contact',
      entityId: contactId,
      score: signals.score,
      label: signals.label,
      summary: `${String(value.action)} ${String(value.reason)}`.trim(),
      factors: signals.factors,
      model,
    });

    return {
      ...insight,
      action: value.action,
      reason: value.reason,
      bestChannel,
      // Null rather than a guess when there is too little history.
      bestHour: hour,
      bestTime:
        hour === null
          ? null
          : `${String(hour).padStart(2, '0')}:00-${String((hour + 1) % 24).padStart(2, '0')}:00`,
    };
  }

  // ── Sentiment ────────────────────────────────

  async sentiment(tenantId: string, conversationId: string) {
    const thread = await this.signals
      .conversationTranscript(tenantId, conversationId)
      .catch(() => null);
    if (!thread) throw new NotFoundException('Conversation not found');

    const { value, model } = await this.ask(
      {
        task: 'sentiment',
        text: thread.transcript,
        channel: thread.channel,
      },
      { score: 0, label: 'neutral', summary: 'No signal either way.' },
    );

    const score = Number(value.score ?? 0);
    return this.saveInsight({
      tenantId,
      type: InsightType.SENTIMENT,
      entityType: 'conversation',
      entityId: conversationId,
      score,
      label: String(value.label ?? 'neutral'),
      summary: String(value.summary ?? ''),
      factors: [],
      model,
    });
  }

  // ── Agentic assistants ───────────────────────

  /** Draft a reply for the agent to review - never sent automatically. */
  async suggestReply(tenantId: string, conversationId: string) {
    const thread = await this.signals
      .conversationTranscript(tenantId, conversationId)
      .catch(() => null);
    if (!thread) throw new NotFoundException('Conversation not found');

    const { value, model } = await this.ask(
      {
        task: 'suggest_reply',
        channel: thread.channel,
        contactName: thread.contactName,
        lastInboundMessage: thread.lastInboundMessage,
        transcript: thread.transcript,
      },
      { reply: '' },
    );

    return {
      reply: String(value.reply ?? ''),
      model,
      source: this.provider.name,
      // Explicit: a suggestion is a draft, and sending stays a human action.
      draft: true,
    };
  }

  /** Everything the CRM knows about a contact, summarised before a meeting. */
  async research(tenantId: string, contactId: string) {
    const dossier = await this.signals
      .contactDossier(tenantId, contactId)
      .catch(() => null);
    if (!dossier) throw new NotFoundException('Contact not found');

    const { value, model } = await this.ask(
      { task: 'research', ...dossier },
      { summary: '' },
    );

    return { summary: String(value.summary ?? ''), facts: dossier, model };
  }

  /** Pulls structured fields out of a conversation, for review before saving. */
  async extract(tenantId: string, conversationId: string) {
    const thread = await this.signals
      .conversationTranscript(tenantId, conversationId)
      .catch(() => null);
    if (!thread) throw new NotFoundException('Conversation not found');

    const { value, model } = await this.ask(
      { task: 'extract', transcript: thread.transcript },
      { fields: {}, summary: '' },
    );

    return {
      fields: value.fields ?? {},
      summary: String(value.summary ?? ''),
      contactId: thread.contactId,
      model,
      // Nothing is written to the CRM until a person accepts it.
      applied: false,
    };
  }

  /**
   * Natural-language question answered from the report catalogue.
   *
   * The model only picks which report to run - it never writes a query - so a
   * question can never reach the database as SQL or cross a tenant boundary.
   */
  async ask_question(tenantId: string, question: string) {
    const catalogue = REPORTS.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
    }));

    const { value, model } = await this.ask(
      { task: 'nl_query', question, reports: catalogue },
      { reportKey: null as string | null, answer: '' },
    );

    const reportKey = value.reportKey ? String(value.reportKey) : null;
    if (!reportKey || !REPORTS.some((r) => r.key === reportKey)) {
      return {
        question,
        reportKey: null,
        answer:
          String(value.answer) ||
          'I could not match that question to a report. Try naming a metric, like pipeline, win rate or first response time.',
        report: null,
        model,
      };
    }

    const report = await this.reports.run(tenantId, reportKey);
    return {
      question,
      reportKey,
      answer: String(value.answer ?? `Here is ${report.name}.`),
      report,
      model,
    };
  }

  // ── History ──────────────────────────────────

  listInsights(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.aiInsight.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /** The freshest score for every contact, for the leaderboard view. */
  async scoreboard(tenantId: string) {
    const insights = await this.prisma.aiInsight.findMany({
      where: { tenantId, type: InsightType.LEAD_SCORE },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const latest = new Map<string, (typeof insights)[number]>();
    for (const insight of insights) {
      if (!latest.has(insight.entityId)) latest.set(insight.entityId, insight);
    }

    const contacts = await this.prisma.contact.findMany({
      where: { tenantId, id: { in: [...latest.keys()] } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    return [...latest.values()]
      .map((insight) => {
        const contact = contacts.find((c) => c.id === insight.entityId);
        return {
          contactId: insight.entityId,
          name: contact
            ? `${contact.firstName} ${contact.lastName}`
            : 'Deleted contact',
          email: contact?.email ?? null,
          score: insight.score ?? 0,
          label: insight.label,
          summary: insight.summary,
          scoredAt: insight.createdAt,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ── Nightly rescoring ────────────────────────

  /** Keeps lead scores current without anyone opening a page. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async rescoreAll(): Promise<void> {
    const contacts = await this.prisma.contact.findMany({
      select: { id: true, tenantId: true },
      take: 1000,
    });

    for (const contact of contacts) {
      try {
        await this.scoreContact(contact.tenantId, contact.id);
      } catch (err) {
        this.logger.warn(
          `Rescoring ${contact.id} failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    this.logger.log(`Rescored ${contacts.length} contact(s)`);
  }
}
