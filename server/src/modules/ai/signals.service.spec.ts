import { Test } from '@nestjs/testing';
import { SignalsService } from './signals.service';
import { PrismaService } from '../../prisma/prisma.service';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe('SignalsService', () => {
  let service: SignalsService;
  let prisma: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      contact: { findFirst: jest.fn() },
      conversation: { findMany: jest.fn().mockResolvedValue([]) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
      emailEvent: { count: jest.fn().mockResolvedValue(0) },
      call: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      deal: { findFirst: jest.fn() },
      activity: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [SignalsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(SignalsService);
  });

  // ── Lead scoring ───────────────────────────────

  it('scores an engaged, senior contact as hot with visible reasons', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      id: 'c1',
      firstName: 'Priya',
      lastName: 'Sharma',
      jobTitle: 'Procurement Head',
      company: { name: 'Globex' },
      deals: [{ status: 'open', value: 1500000 }],
    });
    prisma.conversation.findMany.mockResolvedValue([
      {
        channel: 'WHATSAPP',
        messages: [
          { direction: 'INBOUND', createdAt: daysAgo(1) },
          { direction: 'INBOUND', createdAt: daysAgo(1) },
          { direction: 'INBOUND', createdAt: daysAgo(2) },
          { direction: 'OUTBOUND', createdAt: daysAgo(1) },
        ],
      },
    ]);
    prisma.emailEvent.count.mockResolvedValue(2);
    prisma.call.findMany.mockResolvedValue([
      { status: 'COMPLETED', durationSec: 120, startedAt: daysAgo(2) },
    ]);

    const result = await service.scoreLead(tenantId, 'c1');

    expect(result.label).toBe('hot');
    expect(result.factors.map((f) => f.label)).toEqual(
      expect.arrayContaining([
        'Replies received',
        'Answered a call',
        'Decision-maker title',
        'Open opportunity',
      ]),
    );
    // The score is the sum of its factors - nothing hidden.
    expect(result.score).toBe(
      result.factors.reduce((sum, f) => sum + f.impact, 0),
    );
  });

  it('penalises a contact who never replied', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      id: 'c1',
      firstName: 'Cold',
      lastName: 'Lead',
      jobTitle: null,
      company: null,
      deals: [],
    });

    const result = await service.scoreLead(tenantId, 'c1');

    expect(result.label).toBe('cold');
    expect(result.factors).toContainEqual(
      expect.objectContaining({ label: 'Never replied' }),
    );
  });

  it('marks a contact who has gone quiet', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      id: 'c1',
      firstName: 'Quiet',
      lastName: 'Lead',
      jobTitle: null,
      company: null,
      deals: [],
    });
    prisma.conversation.findMany.mockResolvedValue([
      {
        channel: 'EMAIL',
        messages: [{ direction: 'INBOUND', createdAt: daysAgo(60) }],
      },
    ]);

    const result = await service.scoreLead(tenantId, 'c1');

    expect(result.factors).toContainEqual(
      expect.objectContaining({ label: 'Gone quiet', impact: -15 }),
    );
  });

  it('never lets the score fall below zero or above a hundred', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      id: 'c1',
      firstName: 'X',
      lastName: 'Y',
      jobTitle: null,
      company: null,
      deals: [],
    });
    prisma.conversation.findMany.mockResolvedValue([
      {
        channel: 'EMAIL',
        messages: [{ direction: 'INBOUND', createdAt: daysAgo(400) }],
      },
    ]);

    const result = await service.scoreLead(tenantId, 'c1');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  // ── Deal prediction ────────────────────────────

  it('starts from the stage probability and adds momentum', async () => {
    prisma.deal.findFirst.mockResolvedValue({
      id: 'd1',
      title: 'Globex renewal',
      value: 100000,
      currency: 'INR',
      createdAt: daysAgo(10),
      expectedAt: null,
      ownerId: 'u1',
      contactId: 'c1',
      stage: { name: 'Proposal', probability: 50 },
      contact: { firstName: 'Priya', lastName: 'Sharma' },
    });
    prisma.message.findMany.mockResolvedValue([{ createdAt: daysAgo(2) }]);

    const result = await service.scoreDeal(tenantId, 'd1');

    expect(result.factors[0]).toMatchObject({
      label: 'Pipeline stage',
      impact: 50,
    });
    expect(result.factors).toContainEqual(
      expect.objectContaining({ label: 'Recent reply from the contact' }),
    );
    expect(result.probability).toBe(60);
    expect(result.label).toBe('healthy');
  });

  it('flags a stalled, overdue, ownerless deal as at risk', async () => {
    prisma.deal.findFirst.mockResolvedValue({
      id: 'd1',
      title: 'Stalled deal',
      value: 100000,
      currency: 'INR',
      createdAt: daysAgo(120),
      expectedAt: daysAgo(10),
      ownerId: null,
      contactId: 'c1',
      stage: { name: 'Qualified', probability: 25 },
      contact: null,
    });
    prisma.activity.findMany.mockResolvedValue([{ createdAt: daysAgo(40) }]);
    prisma.message.findMany.mockResolvedValue([{ createdAt: daysAgo(45) }]);

    const result = await service.scoreDeal(tenantId, 'd1');

    expect(result.label).toBe('at_risk');
    expect(result.factors.map((f) => f.label)).toEqual(
      expect.arrayContaining([
        'No activity logged',
        'Contact has gone quiet',
        'Deal is ageing',
        'Past its expected close date',
        'No owner',
      ]),
    );
  });

  // ── Best time / channel ────────────────────────

  it('picks the hour the contact usually replies in', async () => {
    const at = (hour: number) => {
      const d = new Date();
      d.setHours(hour, 0, 0, 0);
      return d;
    };
    prisma.message.findMany.mockResolvedValue([
      { createdAt: at(10) },
      { createdAt: at(10) },
      { createdAt: at(16) },
      { createdAt: at(10) },
    ]);

    await expect(service.bestContactHour(tenantId, 'c1')).resolves.toBe(10);
  });

  it('refuses to guess a best hour from thin history', async () => {
    prisma.message.findMany.mockResolvedValue([{ createdAt: new Date() }]);
    await expect(service.bestContactHour(tenantId, 'c1')).resolves.toBeNull();
  });

  it('ranks channels by how often the contact replies there', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      {
        channel: 'EMAIL',
        messages: [{ direction: 'OUTBOUND', createdAt: daysAgo(1) }],
      },
      {
        channel: 'WHATSAPP',
        messages: [
          { direction: 'INBOUND', createdAt: daysAgo(1) },
          { direction: 'INBOUND', createdAt: daysAgo(2) },
        ],
      },
    ]);

    const ranked = await service.engagementByChannel(tenantId, 'c1');

    expect(ranked[0]).toMatchObject({ channel: 'WHATSAPP', inbound: 2 });
    expect(ranked[1]).toMatchObject({ channel: 'EMAIL', inbound: 0 });
  });
});
