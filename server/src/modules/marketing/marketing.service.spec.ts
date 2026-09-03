import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadsService, scoreLead } from './leads.service';
import { PagesService } from './pages.service';
import { AttributionService, splitCredit } from './attribution.service';

const tenantId = 'tenant-1';

describe('Lead scoring', () => {
  it('rates a work address above a free one', () => {
    const work = scoreLead({ email: 'priya@globex.in' }).score;
    const free = scoreLead({ email: 'priya@gmail.com' }).score;

    expect(work).toBeGreaterThan(free);
  });

  it('gives its reasons rather than just a number', () => {
    const { factors } = scoreLead({
      email: 'priya@globex.in',
      jobTitle: 'Head of Procurement',
    });

    expect(factors.map((f) => f.label)).toEqual(
      expect.arrayContaining([
        'Gave an email address',
        'Work email, not a free one',
        'Seniority in their job title',
      ]),
    );
  });

  it('rates someone who came to us above someone imported', () => {
    const inbound = scoreLead({
      email: 'a@b.in',
      source: 'landing_page',
    }).score;
    const imported = scoreLead({ email: 'a@b.in', source: 'import' }).score;

    expect(inbound).toBeGreaterThan(imported);
  });

  it('never goes above 100', () => {
    const { score } = scoreLead({
      email: 'ceo@globex.in',
      phone: '+91',
      company: 'Globex',
      jobTitle: 'CEO',
      source: 'landing_page',
      utmSource: 'referral',
    });

    expect(score).toBe(100);
  });

  it('scores an empty lead at zero rather than crashing', () => {
    expect(scoreLead({}).score).toBe(0);
  });
});

describe('Attribution splits', () => {
  const touch = (key: string, day: number) => ({
    key,
    label: key,
    occurredAt: new Date(`2026-01-${String(day).padStart(2, '0')}T00:00:00Z`),
  });

  it('first-touch credits what brought them in', () => {
    const credit = splitCredit(
      [touch('page:a', 3), touch('campaign:b', 1)],
      1000,
      'first',
    );

    // Order in the array must not matter; the earliest touch wins.
    expect(credit.get('campaign:b')).toBe(1000);
    expect(credit.get('page:a')).toBeUndefined();
  });

  it('last-touch credits what closed it', () => {
    const credit = splitCredit(
      [touch('campaign:b', 1), touch('page:a', 3)],
      1000,
      'last',
    );

    expect(credit.get('page:a')).toBe(1000);
  });

  it('linear refuses to choose', () => {
    const credit = splitCredit(
      [touch('a', 1), touch('b', 2), touch('c', 3), touch('d', 4)],
      1000,
      'linear',
    );

    expect(credit.get('a')).toBe(250);
    expect([...credit.values()].reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('adds up to the deal value whichever model is used', () => {
    const touches = [touch('a', 1), touch('b', 2), touch('a', 3)];
    for (const model of ['first', 'last', 'linear'] as const) {
      const total = [...splitCredit(touches, 900, model).values()].reduce(
        (a, b) => a + b,
        0,
      );
      expect(total).toBeCloseTo(900);
    }
  });

  it('gives a repeated touch its share each time it appears', () => {
    const credit = splitCredit(
      [touch('a', 1), touch('a', 2), touch('b', 3)],
      900,
      'linear',
    );

    expect(credit.get('a')).toBe(600);
    expect(credit.get('b')).toBe(300);
  });

  it('credits nothing when there is nothing to credit', () => {
    expect(splitCredit([], 1000, 'linear').size).toBe(0);
  });
});

describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      lead: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'l1', ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'l1', ...data }),
          ),
        delete: jest.fn(),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findFirst: jest.fn(), create: jest.fn() },
      contact: {
        create: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
      deal: { create: jest.fn().mockResolvedValue({ id: 'd1' }) },
      dealStage: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      touchpoint: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [LeadsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(LeadsService);
  });

  it('updates the same person instead of making a second lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'l1',
      firstName: 'Priya',
      email: 'priya@globex.in',
      source: 'landing_page',
      utmSource: 'newsletter',
      fields: { interest: 'crm' },
    });

    await service.capture(tenantId, {
      firstName: 'Priya',
      email: 'PRIYA@globex.in',
      phone: '+91-98',
      source: 'web_form',
    });

    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.lead.update.mock.calls[0][0].data.phone).toBe('+91-98');
  });

  it('keeps the first touch rather than overwriting it', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'l1',
      firstName: 'Priya',
      email: 'priya@globex.in',
      source: 'landing_page',
      sourceDetail: 'pricing',
      utmSource: 'newsletter',
      fields: {},
    });

    await service.capture(tenantId, {
      firstName: 'Priya',
      email: 'priya@globex.in',
      source: 'web_form',
      utmSource: 'google',
    });

    // What brought them the first time is the thing that worked.
    const data = prisma.lead.update.mock.calls[0][0].data;
    expect(data.source).toBe('landing_page');
    expect(data.utmSource).toBe('newsletter');
  });

  it('merges new form answers into what is already known', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'l1',
      firstName: 'Priya',
      email: 'priya@globex.in',
      fields: { interest: 'crm' },
    });

    await service.capture(tenantId, {
      firstName: 'Priya',
      email: 'priya@globex.in',
      fields: { seats: '50' },
    });

    expect(prisma.lead.update.mock.calls[0][0].data.fields).toEqual({
      interest: 'crm',
      seats: '50',
    });
  });

  it('gives a new lead to whoever is carrying the fewest', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([
      { id: 'busy', _count: { ownedLeads: 9 } },
      { id: 'free', _count: { ownedLeads: 1 } },
    ]);

    await service.capture(tenantId, { firstName: 'New', email: 'n@b.in' });

    expect(prisma.lead.create.mock.calls[0][0].data.ownerId).toBe('free');
  });

  it('does not fold a new enquiry into somebody already converted', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);

    await service.capture(tenantId, { firstName: 'Priya', email: 'p@b.in' });

    expect(prisma.lead.findFirst.mock.calls[0][0].where.status).toEqual({
      not: LeadStatus.CONVERTED,
    });
  });

  it('converting keeps the lead and points the trail at the contact', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'l1',
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@globex.in',
      company: 'Globex',
      score: 70,
      ownerId: 'u1',
      convertedAt: null,
      touchpoints: [],
    });
    prisma.company.findFirst.mockResolvedValue({ id: 'co1' });

    const result = await service.convert(tenantId, 'l1', {});

    expect(result).toMatchObject({ contactId: 'c1', companyId: 'co1' });
    // The trail follows the person rather than stopping at conversion.
    expect(prisma.touchpoint.updateMany.mock.calls[0][0].data).toEqual({
      contactId: 'c1',
    });
    expect(prisma.lead.delete).not.toHaveBeenCalled();
    expect(prisma.lead.update.mock.calls[0][0].data.status).toBe(
      LeadStatus.CONVERTED,
    );
  });

  it('reuses an account of the same name instead of making a second one', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'l1',
      firstName: 'Priya',
      company: 'Globex',
      convertedAt: null,
      touchpoints: [],
    });
    prisma.company.findFirst.mockResolvedValue({ id: 'existing' });

    const result = await service.convert(tenantId, 'l1', {});

    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(result.companyId).toBe('existing');
  });

  it('refuses to convert the same lead twice', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'l1',
      firstName: 'Priya',
      convertedAt: new Date(),
      touchpoints: [],
    });

    await expect(service.convert(tenantId, 'l1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to edit a converted lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'l1',
      firstName: 'Priya',
      status: LeadStatus.CONVERTED,
      touchpoints: [],
    });

    await expect(
      service.update(tenantId, 'l1', { firstName: 'Riya' }),
    ).rejects.toThrow('work the contact instead');
  });
});

describe('PagesService', () => {
  let service: PagesService;
  let prisma: any;
  let leads: { capture: jest.Mock; recordTouch: jest.Mock };

  beforeEach(async () => {
    prisma = {
      marketingForm: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'f1',
          name: 'Demo request',
          thankYou: 'Thanks!',
          assignToId: null,
        }),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      landingPage: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
      formSubmission: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
      },
    };
    leads = {
      capture: jest.fn().mockResolvedValue({ id: 'l1' }),
      recordTouch: jest.fn().mockResolvedValue({}),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LeadsService, useValue: leads },
      ],
    }).compile();
    service = moduleRef.get(PagesService);
  });

  it('turns a submission into a lead and records the touch', async () => {
    prisma.landingPage.findFirst.mockResolvedValue({
      id: 'p1',
      title: 'Pricing',
      slug: 'pricing',
    });

    const result = await service.submit(tenantId, 'f1', {
      pageId: 'p1',
      data: { name: 'Priya', email: 'priya@globex.in', company: 'Globex' },
      utm: { utm_source: 'google' },
    });

    expect(leads.capture.mock.calls[0][1]).toMatchObject({
      firstName: 'Priya',
      email: 'priya@globex.in',
      source: 'landing_page',
      sourceDetail: 'pricing',
      utmSource: 'google',
    });
    expect(leads.recordTouch).toHaveBeenCalled();
    expect(result.message).toBe('Thanks!');
  });

  it('does not hand a CRM id back to a public page', async () => {
    prisma.landingPage.findFirst.mockResolvedValue(null);

    const result = await service.submit(tenantId, 'f1', {
      data: { email: 'a@b.in' },
    });

    expect(result).not.toHaveProperty('leadId');
    expect(JSON.stringify(result)).not.toContain('l1');
  });

  it('keeps the submission even when the form gave no name', async () => {
    prisma.landingPage.findFirst.mockResolvedValue(null);

    await service.submit(tenantId, 'f1', { data: { email: 'a@b.in' } });

    // A form that silently loses what somebody typed is worse than one that
    // duplicates, so the row is written regardless.
    expect(prisma.formSubmission.create).toHaveBeenCalled();
    expect(leads.capture.mock.calls[0][1].firstName).toBe('Unknown');
  });

  it('a 404 on the form stops the submission going nowhere quietly', async () => {
    prisma.marketingForm.findFirst.mockResolvedValue(null);

    await expect(
      service.submit(tenantId, 'nope', { data: {} }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('counts a view against the variant that was actually shown', async () => {
    prisma.landingPage.findFirst.mockResolvedValue({
      id: 'p1',
      slug: 'pricing',
      title: 'A',
      blocks: [],
      variantWeight: 0,
      form: null,
      tenant: { name: 'Acme' },
      variants: [
        {
          id: 'p2',
          slug: 'pricing-b',
          title: 'B',
          blocks: [],
          variantWeight: 100,
          metaTitle: null,
          metaDescription: null,
        },
      ],
    });

    const view = await service.publicPage(tenantId, 'pricing');

    // Weight 0 vs 100: the variant always wins, and it is the variant whose
    // view count moves.
    expect(view.variantId).toBe('p2');
    expect(prisma.landingPage.update.mock.calls[0][0].where.id).toBe('p2');
  });

  it('refuses to publish a page with nothing on it', async () => {
    prisma.landingPage.findFirst.mockResolvedValue({ id: 'p1', blocks: [] });

    await expect(service.publishPage(tenantId, 'p1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a draft page is not reachable publicly', async () => {
    prisma.landingPage.findFirst.mockResolvedValue(null);

    await expect(
      service.publicPage(tenantId, 'draft-page'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.landingPage.findFirst.mock.calls[0][0].where.status).toBe(
      'PUBLISHED',
    );
  });
});

describe('AttributionService', () => {
  let service: AttributionService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      deal: { findMany: jest.fn().mockResolvedValue([]) },
      touchpoint: { findMany: jest.fn().mockResolvedValue([]) },
      campaign: { findMany: jest.fn().mockResolvedValue([]) },
      campaignRecipient: { groupBy: jest.fn().mockResolvedValue([]) },
      lead: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AttributionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AttributionService);
  });

  it('only credits revenue that has actually been won', async () => {
    await service.revenue(tenantId, {});

    expect(prisma.deal.findMany.mock.calls[0][0].where.status).toBe('won');
  });

  it('counts a won deal with no contact rather than dropping it', async () => {
    prisma.deal.findMany.mockResolvedValue([
      { id: 'd1', value: 320000, contactId: null, closedAt: new Date() },
    ]);

    const result = await service.revenue(tenantId, {});

    // Filtering these out would quietly shrink the revenue the report claims
    // to be splitting up.
    expect(result.wonRevenue).toBe(320000);
    expect(result.uncreditedRevenue).toBe(320000);
    expect(
      prisma.deal.findMany.mock.calls[0][0].where.contactId,
    ).toBeUndefined();
  });

  it('reports revenue no marketing touch can explain', async () => {
    prisma.deal.findMany.mockResolvedValue([
      { id: 'd1', value: 1000, contactId: 'c1', closedAt: new Date() },
      { id: 'd2', value: 500, contactId: 'c2', closedAt: new Date() },
    ]);
    prisma.touchpoint.findMany.mockResolvedValue([
      {
        contactId: 'c1',
        campaignId: 'cam1',
        pageId: null,
        occurredAt: new Date('2026-01-01Z'),
        campaign: { id: 'cam1', name: 'Spring push' },
        page: null,
      },
    ]);

    const result = await service.revenue(tenantId, { model: 'linear' });

    // Saying so is the difference between attribution and wishful thinking.
    expect(result.creditedRevenue).toBe(1000);
    expect(result.uncreditedRevenue).toBe(500);
    expect(result.wonRevenue).toBe(1500);
  });

  it('leaves out a touch that names neither a campaign nor a page', async () => {
    prisma.deal.findMany.mockResolvedValue([
      { id: 'd1', value: 1000, contactId: 'c1', closedAt: new Date() },
    ]);
    prisma.touchpoint.findMany.mockResolvedValue([
      {
        contactId: 'c1',
        campaignId: null,
        pageId: null,
        occurredAt: new Date(),
        campaign: null,
        page: null,
      },
    ]);

    const result = await service.revenue(tenantId, {});

    // Rather than an "other" bucket that quietly absorbs the revenue.
    expect(result.rows).toHaveLength(0);
    expect(result.uncreditedRevenue).toBe(1000);
  });

  it('has no ROI for a campaign that cost nothing', async () => {
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: 'cam1',
        name: 'Free push',
        channel: 'EMAIL',
        status: 'SENT',
        cost: 0,
        currency: 'INR',
        _count: { recipients: 10 },
      },
    ]);

    const { rows } = await service.campaignRoi(tenantId, {});

    // Null rather than infinity: a free campaign has revenue, not a return.
    expect(rows[0].roi).toBeNull();
  });

  it('works ROI out from the same split the attribution table shows', async () => {
    prisma.deal.findMany.mockResolvedValue([
      { id: 'd1', value: 10000, contactId: 'c1', closedAt: new Date() },
    ]);
    prisma.touchpoint.findMany.mockResolvedValue([
      {
        contactId: 'c1',
        campaignId: 'cam1',
        pageId: null,
        occurredAt: new Date(),
        campaign: { id: 'cam1', name: 'Spring push' },
        page: null,
      },
    ]);
    prisma.campaign.findMany.mockResolvedValue([
      {
        id: 'cam1',
        name: 'Spring push',
        channel: 'EMAIL',
        status: 'SENT',
        cost: 2000,
        currency: 'INR',
        _count: { recipients: 100 },
      },
    ]);

    const { rows } = await service.campaignRoi(tenantId, {});

    expect(rows[0].revenue).toBe(10000);
    expect(rows[0].roi).toBe(400); // (10000 - 2000) / 2000
  });

  it('measures each funnel step against the top, and the drop from the last', async () => {
    prisma.lead.count
      .mockResolvedValueOnce(100) // leads
      .mockResolvedValueOnce(60) // engaged
      .mockResolvedValueOnce(30) // qualified
      .mockResolvedValueOnce(20) // converted
      .mockResolvedValueOnce(10); // opened a deal

    const steps = await service.funnel(tenantId);

    expect(steps[1]).toMatchObject({ count: 60, ofTotal: 60, dropOff: 40 });
    expect(steps[2]).toMatchObject({ count: 30, ofTotal: 30, dropOff: 50 });
  });
});
