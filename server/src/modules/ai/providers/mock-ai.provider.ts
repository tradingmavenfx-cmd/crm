import { Injectable, Logger } from '@nestjs/common';
import {
  AiCompletionInput,
  AiCompletionResult,
  AiProvider,
} from './ai-provider.interface';

/**
 * Used when no AI credentials are configured.
 *
 * The numbers this CRM shows are computed from its own data, not invented by a
 * model - the model's job is only to put them into words. So the mock reads the
 * same structured facts the real provider gets and writes a deterministic
 * sentence from them. Every AI flow therefore works end to end in dev, and the
 * figures are identical with or without a key.
 */
@Injectable()
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('AiMock');

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const facts = this.parseFacts(input);
    const task = String(facts.task ?? 'unknown');
    this.logger.log(`[mock] ${task}`);

    return { text: JSON.stringify(this.respond(task, facts)), model: 'mock' };
  }

  private parseFacts(input: AiCompletionInput): Record<string, unknown> {
    const last = input.messages[input.messages.length - 1]?.content ?? '{}';
    try {
      return JSON.parse(last) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private list(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  }

  private respond(task: string, facts: Record<string, unknown>) {
    switch (task) {
      case 'lead_score':
        return { summary: this.leadScoreSummary(facts) };

      case 'deal_risk':
        return { summary: this.dealRiskSummary(facts) };

      case 'next_action':
        return this.nextAction(facts);

      case 'sentiment':
        return this.sentiment(facts);

      case 'suggest_reply':
        return { reply: this.suggestReply(facts) };

      case 'research':
        return { summary: this.research(facts) };

      case 'extract':
        return this.extract(facts);

      case 'nl_query':
        return this.nlQuery(facts);

      default:
        return { summary: 'No AI provider configured.' };
    }
  }

  private leadScoreSummary(facts: Record<string, unknown>): string {
    const name = String(facts.name ?? 'This contact');
    const score = Number(facts.score ?? 0);
    const band = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
    const top = this.list(facts.factors)
      .filter((f) => Number(f.impact) > 0)
      .slice(0, 2)
      .map((f) => String(f.label).toLowerCase());

    return top.length
      ? `${name} scores ${score} (${band}), driven by ${top.join(' and ')}.`
      : `${name} scores ${score} (${band}) - there is little engagement to go on yet.`;
  }

  private dealRiskSummary(facts: Record<string, unknown>): string {
    const title = String(facts.title ?? 'This deal');
    const probability = Number(facts.probability ?? 0);
    const risks = this.list(facts.factors)
      .filter((f) => Number(f.impact) < 0)
      .slice(0, 2)
      .map((f) => String(f.label).toLowerCase());

    return risks.length
      ? `${title} sits at ${probability}% - watch ${risks.join(' and ')}.`
      : `${title} sits at ${probability}% with no warning signs in the data.`;
  }

  private nextAction(facts: Record<string, unknown>) {
    const channel = String(facts.bestChannel ?? 'email');
    const name = String(facts.name ?? 'the contact');
    const days = Number(facts.daysSinceContact ?? 0);

    const action =
      days > 14
        ? `Re-engage ${name} - it has been ${days} days since the last touch.`
        : days > 3
          ? `Follow up with ${name} on the open thread.`
          : `Keep the current conversation with ${name} moving.`;

    return { action, reason: `They reply most often on ${channel}.` };
  }

  private sentiment(facts: Record<string, unknown>) {
    const text = String(facts.text ?? '').toLowerCase();
    const negative = [
      'urgent',
      'complaint',
      'not working',
      'broken',
      'angry',
      'refund',
      'cancel',
      'disappointed',
      'delay',
    ];
    const positive = [
      'thanks',
      'thank you',
      'great',
      'perfect',
      'happy',
      'excellent',
      'works',
      'appreciate',
    ];

    const negHits = negative.filter((w) => text.includes(w));
    const posHits = positive.filter((w) => text.includes(w));
    const score = (posHits.length - negHits.length) * 30;
    const clamped = Math.max(-100, Math.min(100, score));

    return {
      score: clamped,
      label: clamped > 20 ? 'positive' : clamped < -20 ? 'negative' : 'neutral',
      summary: negHits.length
        ? `Signals of frustration: ${negHits.join(', ')}.`
        : posHits.length
          ? `Positive signals: ${posHits.join(', ')}.`
          : 'Neutral in tone.',
    };
  }

  private suggestReply(facts: Record<string, unknown>): string {
    const name = String(facts.contactName ?? 'there').split(' ')[0];
    const last = String(facts.lastInboundMessage ?? '').trim();
    const question = last.includes('?');

    return question
      ? `Hi ${name}, thanks for asking - let me get you a clear answer on that today.`
      : `Hi ${name}, thanks for getting back to us. I will pick this up and come back to you shortly.`;
  }

  private research(facts: Record<string, unknown>): string {
    const name = String(facts.name ?? 'This contact');
    const company = facts.company ? ` at ${String(facts.company)}` : '';
    const deals = Number(facts.openDeals ?? 0);
    const messages = Number(facts.messageCount ?? 0);
    const channels = this.list(facts.channels)
      .map((c) => String(c.channel))
      .join(', ');

    return [
      `${name}${company}.`,
      messages
        ? `${messages} messages exchanged${channels ? ` across ${channels}` : ''}.`
        : 'No conversation history yet.',
      deals ? `${deals} open deal(s).` : 'No open deals.',
    ].join(' ');
  }

  private extract(facts: Record<string, unknown>) {
    // Pull the obvious structured fields straight out of the transcript.
    const text = String(facts.transcript ?? '');
    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
    const phone = text.match(/\+?\d[\d\s-]{7,}\d/)?.[0];
    const amount = text.match(/(?:rs\.?|inr|₹)\s?([\d,]+)/i)?.[1];

    return {
      fields: {
        ...(email ? { email } : {}),
        ...(phone ? { phone: phone.trim() } : {}),
        ...(amount ? { dealValue: amount.replace(/,/g, '') } : {}),
      },
      summary: 'Extracted the contact details present in the transcript.',
    };
  }

  private nlQuery(facts: Record<string, unknown>) {
    const question = String(facts.question ?? '').toLowerCase();
    const reports = this.list(facts.reports);

    // Score each report on how many of its words the question mentions.
    const best = reports
      .map((r) => {
        const words = `${r.name} ${r.description} ${r.key}`
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((w) => w.length > 3);
        const hits = new Set(words.filter((w) => question.includes(w)));
        return { key: String(r.key), name: String(r.name), hits: hits.size };
      })
      .sort((a, b) => b.hits - a.hits)[0];

    if (!best || best.hits === 0) {
      return {
        reportKey: null,
        answer:
          'No AI provider is configured, and no report obviously matches that question. Pick one from the reports page.',
      };
    }

    return {
      reportKey: best.key,
      answer: `Closest match: ${best.name}.`,
    };
  }
}
