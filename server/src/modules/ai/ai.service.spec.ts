import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InsightType } from '@prisma/client';
import { AiService } from './ai.service';
import { SignalsService } from './signals.service';
import { ReportsService } from '../reports/reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER, AiProvider } from './providers/ai-provider.interface';
import { MockAiProvider } from './providers/mock-ai.provider';

const leadSignals = {
  score: 72,
  label: 'hot' as const,
  factors: [
    { label: 'Replies received', impact: 24, detail: '3 inbound message(s)' },
    { label: 'Gone quiet', impact: -15, detail: '40 days' },
  ],
  context: { name: 'Priya Sharma', daysSinceReply: 2, openDeals: 1 },
};

const dealSignals = {
  probability: 35,
  label: 'watch' as const,
  factors: [
    { label: 'Pipeline stage', impact: 50, detail: 'Proposal' },
    { label: 'Deal is ageing', impact: -15, detail: '120 days' },
  ],
  context: { title: 'Globex renewal' },
};

describe('AiService', () => {
  let service: AiService;
  let prisma: any;
  let signals: any;
  let reports: { run: jest.Mock };
  let provider: jest.Mocked<AiProvider>;
  const tenantId = 'tenant-1';

  const build = async (aiProvider: AiProvider) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: prisma },
        { provide: SignalsService, useValue: signals },
        { provide: ReportsService, useValue: reports },
        { provide: AI_PROVIDER, useValue: aiProvider },
      ],
    }).compile();
    return moduleRef.get(AiService);
  };

  beforeEach(async () => {
    prisma = {
      aiInsight: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'i1', ...data }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      contact: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      deal: { findMany: jest.fn().mockResolvedValue([]) },
    };
    signals = {
      scoreLead: jest.fn().mockResolvedValue(leadSignals),
      scoreDeal: jest.fn().mockResolvedValue(dealSignals),
      engagementByChannel: jest
        .fn()
        .mockResolvedValue([{ channel: 'WHATSAPP', inbound: 3, outbound: 2 }]),
      bestContactHour: jest.fn().mockResolvedValue(10),
      conversationTranscript: jest.fn().mockResolvedValue({
        channel: 'SMS',
        contactName: 'Priya Sharma',
        contactId: 'c1',
        lastInboundMessage: 'This is urgent, my order has not arrived',
        transcript: 'Customer: This is urgent, my order has not arrived',
      }),
      contactDossier: jest.fn().mockResolvedValue({
        name: 'Priya Sharma',
        company: 'Globex',
        openDeals: 1,
        messageCount: 5,
        channels: [{ channel: 'WHATSAPP' }],
      }),
    };
    reports = {
      run: jest.fn().mockResolvedValue({
        key: 'sales.pipeline',
        name: 'Pipeline by stage',
        rows: [],
      }),
    };
    provider = {
      name: 'mock',
      complete: jest.fn().mockResolvedValue({
        text: '{"summary":"Looks good."}',
        model: 'mock',
      }),
    };

    service = await build(provider);
  });

  // ── Scoring ────────────────────────────────────

  it('stores the computed score, not one the model invented', async () => {
    provider.complete.mockResolvedValue({
      // A model claiming a different number must not override the CRM's own.
      text: '{"summary":"Very promising.","score":99}',
      model: 'gpt-test',
    });

    const insight = await service.scoreContact(tenantId, 'c1');

    expect(insight.score).toBe(72);
    expect(insight.summary).toBe('Very promising.');
    expect(insight.type).toBe(InsightType.LEAD_SCORE);
  });

  it('writes the score back onto the contact', async () => {
    await service.scoreContact(tenantId, 'c1');

    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', tenantId },
      data: { score: 72 },
    });
  });

  it('keeps the factors on the insight so the score is explainable', async () => {
    const insight = await service.scoreContact(tenantId, 'c1');
    expect(insight.factors).toEqual(leadSignals.factors);
  });

  it('still scores when the model is unavailable', async () => {
    provider.complete.mockRejectedValue(new Error('provider down'));

    const insight = await service.scoreContact(tenantId, 'c1');

    expect(insight.score).toBe(72);
    expect(insight.summary).toBe('Scored 72 (hot).');
    expect(insight.model).toBe('unavailable');
  });

  it('falls back cleanly when the model returns unparseable text', async () => {
    provider.complete.mockResolvedValue({
      text: 'not json',
      model: 'gpt-test',
    });

    const insight = await service.scoreContact(tenantId, 'c1');

    expect(insight.score).toBe(72);
    expect(insight.summary).toBe('Scored 72 (hot).');
  });

  it('throws NotFound for a contact outside the tenant', async () => {
    signals.scoreLead.mockRejectedValue(new Error('Contact not found'));
    await expect(
      service.scoreContact(tenantId, 'other'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── Deal prediction ────────────────────────────

  it('predicts a deal and records the risk factors', async () => {
    const insight = await service.predictDeal(tenantId, 'd1');

    expect(insight.score).toBe(35);
    expect(insight.label).toBe('watch');
    expect(insight.type).toBe(InsightType.DEAL_RISK);
  });

  it('lists only the deals that are not healthy, worst first', async () => {
    prisma.deal.findMany.mockResolvedValue([
      { id: 'd1', title: 'Healthy' },
      { id: 'd2', title: 'Risky' },
    ]);
    signals.scoreDeal
      .mockResolvedValueOnce({
        ...dealSignals,
        probability: 80,
        label: 'healthy',
      })
      .mockResolvedValueOnce({
        ...dealSignals,
        probability: 12,
        label: 'at_risk',
      });

    const risky = await service.atRiskDeals(tenantId);

    expect(risky).toHaveLength(1);
    expect(risky[0]).toMatchObject({ title: 'Risky', probability: 12 });
  });

  // ── Coaching ───────────────────────────────────

  it('recommends the channel the contact actually replies on', async () => {
    const coaching = await service.coach(tenantId, 'c1');

    expect(coaching.bestChannel).toBe('WHATSAPP');
    expect(coaching.bestTime).toBe('10:00-11:00');
  });

  it('offers no best time when the history is too thin', async () => {
    signals.bestContactHour.mockResolvedValue(null);

    const coaching = await service.coach(tenantId, 'c1');

    expect(coaching.bestHour).toBeNull();
    expect(coaching.bestTime).toBeNull();
  });

  it('reports no preferred channel when nobody has ever replied', async () => {
    signals.engagementByChannel.mockResolvedValue([
      { channel: 'EMAIL', inbound: 0, outbound: 4 },
    ]);

    const coaching = await service.coach(tenantId, 'c1');

    expect(coaching.bestChannel).toBeNull();
  });

  // ── Suggestions stay drafts ────────────────────

  it('greets an unknown caller neutrally rather than by their number', async () => {
    signals.conversationTranscript.mockResolvedValue({
      channel: 'SMS',
      contactName: null,
      externalId: '+919555000222',
      contactId: null,
      lastInboundMessage: 'hello?',
      transcript: 'Customer: hello?',
    });
    service = await build(new MockAiProvider());

    const suggestion = await service.suggestReply(tenantId, 'conv1');

    expect(suggestion.reply).not.toContain('+9195');
    expect(suggestion.reply).toContain('Hi there');
  });

  it('marks a suggested reply as a draft and sends nothing', async () => {
    provider.complete.mockResolvedValue({
      text: '{"reply":"Hi Priya, on it today."}',
      model: 'mock',
    });

    const suggestion = await service.suggestReply(tenantId, 'conv1');

    expect(suggestion).toMatchObject({
      reply: 'Hi Priya, on it today.',
      draft: true,
    });
  });

  it('marks extracted fields as not yet applied', async () => {
    provider.complete.mockResolvedValue({
      text: '{"fields":{"email":"a@b.com"},"summary":"Found an email."}',
      model: 'mock',
    });

    const extracted = await service.extract(tenantId, 'conv1');

    expect(extracted.applied).toBe(false);
    expect(extracted.fields).toEqual({ email: 'a@b.com' });
  });

  // ── Natural-language queries ───────────────────

  it('answers a question by running the report the model chose', async () => {
    provider.complete.mockResolvedValue({
      text: '{"reportKey":"sales.pipeline","answer":"Here is the pipeline."}',
      model: 'mock',
    });

    const result = await service.ask_question(tenantId, 'how is our pipeline?');

    expect(reports.run).toHaveBeenCalledWith(tenantId, 'sales.pipeline');
    expect(result.report).toMatchObject({ key: 'sales.pipeline' });
  });

  it('refuses a report key that is not in the catalogue', async () => {
    provider.complete.mockResolvedValue({
      // A model hallucinating a key must never reach the report runner.
      text: '{"reportKey":"secret.dump_everything","answer":"here"}',
      model: 'mock',
    });

    const result = await service.ask_question(tenantId, 'dump everything');

    expect(reports.run).not.toHaveBeenCalled();
    expect(result.reportKey).toBeNull();
    expect(result.report).toBeNull();
  });

  // ── The mock provider itself ───────────────────

  describe('with the mock provider', () => {
    beforeEach(async () => {
      service = await build(new MockAiProvider());
    });

    it('writes an explanation from the computed factors', async () => {
      const insight = await service.scoreContact(tenantId, 'c1');

      expect(insight.summary).toContain('Priya Sharma');
      expect(insight.summary).toContain('72');
      expect(insight.summary).toContain('replies received');
      expect(insight.source).toBe('mock');
    });

    it('detects frustration in a conversation', async () => {
      const insight = await service.sentiment(tenantId, 'conv1');

      expect(insight.label).toBe('negative');
      expect(insight.score).toBeLessThan(0);
      expect(insight.summary).toContain('urgent');
    });

    it('drafts a reply that names the contact', async () => {
      const suggestion = await service.suggestReply(tenantId, 'conv1');
      expect(suggestion.reply).toContain('Priya');
    });

    it('matches a question to a report by its own words', async () => {
      const result = await service.ask_question(
        tenantId,
        'what does the pipeline look like by stage?',
      );

      expect(result.reportKey).toBe('sales.pipeline');
    });

    it('says so plainly when nothing matches', async () => {
      const result = await service.ask_question(tenantId, 'zzz qqq');

      expect(result.reportKey).toBeNull();
      expect(result.report).toBeNull();
      expect(result.answer).toContain('no report obviously matches');
    });
  });
});
