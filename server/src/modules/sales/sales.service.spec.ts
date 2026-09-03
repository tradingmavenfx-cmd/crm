import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContestMetric, ForecastCategory, QuotaPeriod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TerritoriesService, matchScore } from './territories.service';
import {
  ForecastService,
  deriveCategory,
  periodRange,
} from './forecast.service';
import { GamificationService, scoreOf } from './gamification.service';

const tenantId = 'tenant-1';

const company = (over: Record<string, unknown> = {}) => ({
  city: 'Bengaluru',
  state: 'Karnataka',
  country: 'India',
  industry: 'Manufacturing',
  employees: 200,
  domain: 'acme.co.in',
  ...over,
});

describe('Territory rules', () => {
  it('claims a company when the one clause it sets matches', () => {
    expect(matchScore({ states: ['Karnataka'] }, company())).toBe(1);
  });

  it('does not claim a company that fails any clause it sets', () => {
    // "Manufacturing in Karnataka" must not swallow every company in Karnataka.
    expect(
      matchScore(
        { states: ['Karnataka'], industries: ['Software'] },
        company(),
      ),
    ).toBeNull();
  });

  it('scores the more specific territory higher', () => {
    const broad = matchScore({ countries: ['India'] }, company())!;
    const narrow = matchScore(
      { countries: ['India'], states: ['Karnataka'], cities: ['Bengaluru'] },
      company(),
    )!;

    expect(narrow).toBeGreaterThan(broad);
  });

  it('ignores case and stray spaces', () => {
    expect(
      matchScore({ countries: ['  india '] }, company({ country: 'India' })),
    ).toBe(1);
  });

  it('matches a domain as a suffix, so a subdomain still counts', () => {
    expect(
      matchScore(
        { domains: ['acme.co.in'] },
        company({ domain: 'in.acme.co.in' }),
      ),
    ).toBe(1);
  });

  it('treats a territory with no rules as hand-picked only', () => {
    expect(matchScore({}, company())).toBeNull();
  });

  it('handles a company that is missing the field a rule asks about', () => {
    expect(
      matchScore({ states: ['Karnataka'] }, company({ state: null })),
    ).toBeNull();
    expect(
      matchScore({ minEmployees: 10 }, company({ employees: null })),
    ).toBeNull();
  });

  it('reads employee bands as inclusive bounds', () => {
    expect(matchScore({ minEmployees: 200 }, company())).toBe(1);
    expect(matchScore({ maxEmployees: 200 }, company())).toBe(1);
    expect(matchScore({ minEmployees: 201 }, company())).toBeNull();
  });
});

describe('TerritoriesService', () => {
  let service: TerritoriesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      territory: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      territoryMember: { upsert: jest.fn(), deleteMany: jest.fn() },
      company: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      deal: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findFirst: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TerritoriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(TerritoriesService);
  });

  it('refuses to make a territory its own parent', async () => {
    prisma.territory.findFirst.mockResolvedValue({ id: 't1', parentId: null });

    await expect(
      service.update(tenantId, 't1', { parentId: 't1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a move that would put a territory inside its own child', async () => {
    // t1 -> t2 -> t3; moving t1 under t3 would make the tree a loop.
    const tree: Record<string, string | null> = {
      t1: null,
      t2: 't1',
      t3: 't2',
    };
    prisma.territory.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve({ id: where.id, parentId: tree[where.id] ?? null }),
    );

    await expect(
      service.update(tenantId, 't1', { parentId: 't3' }),
    ).rejects.toThrow('own children');
  });

  it('only files accounts that belong nowhere yet', async () => {
    await service.assign(tenantId);

    expect(prisma.company.findMany.mock.calls[0][0].where).toMatchObject({
      territoryId: null,
    });
  });

  it('reassigns everything only when asked', async () => {
    await service.assign(tenantId, true);

    expect(
      prisma.company.findMany.mock.calls[0][0].where.territoryId,
    ).toBeUndefined();
  });

  it('files a company into the most specific territory that fits', async () => {
    prisma.territory.findMany.mockResolvedValue([
      { id: 'india', name: 'India', rules: { countries: ['India'] } },
      {
        id: 'blr',
        name: 'Bengaluru',
        rules: { countries: ['India'], cities: ['Bengaluru'] },
      },
    ]);
    prisma.company.findMany.mockResolvedValue([{ id: 'c1', ...company() }]);

    const result = await service.assign(tenantId);

    expect(prisma.company.update.mock.calls[0][0].data.territoryId).toBe('blr');
    expect(result).toMatchObject({ considered: 1, assigned: 1, unmatched: 0 });
  });

  it('counts an account no rule claimed rather than hiding it', async () => {
    prisma.territory.findMany.mockResolvedValue([
      { id: 'uk', name: 'UK', rules: { countries: ['United Kingdom'] } },
    ]);
    prisma.company.findMany.mockResolvedValue([{ id: 'c1', ...company() }]);

    const result = await service.assign(tenantId);

    expect(result).toMatchObject({ assigned: 0, unmatched: 1 });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('rolls a parent territory up over everything beneath it', async () => {
    prisma.territory.findMany.mockResolvedValue([
      { id: 'india', name: 'India', parentId: null },
      { id: 'south', name: 'South', parentId: 'india' },
    ]);
    prisma.company.findMany.mockResolvedValue([
      { id: 'c1', territoryId: 'south' },
    ]);
    prisma.deal.findMany.mockResolvedValue([
      { companyId: 'c1', value: 100, status: 'won' },
      { companyId: 'c1', value: 40, status: 'lost' },
      { companyId: 'c1', value: 60, status: 'open' },
    ]);

    const rows = await service.performance(tenantId);
    const india = rows.find((r) => r.id === 'india')!;
    const south = rows.find((r) => r.id === 'south')!;

    // A region reporting only its own direct accounts tells a manager nothing.
    expect(south.won).toBe(100);
    expect(india.won).toBe(100);
    expect(india.open).toBe(60);
    expect(india.winRate).toBe(71); // 100 of 140 decided
  });
});

describe('Forecast periods and categories', () => {
  it('snaps a date to the quarter it falls in', () => {
    const { start, end } = periodRange(
      QuotaPeriod.QUARTER,
      new Date('2026-05-17T10:00:00Z'),
    );

    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('snaps to the month and the year too', () => {
    expect(
      periodRange(
        QuotaPeriod.MONTH,
        new Date('2026-05-17Z'),
      ).start.toISOString(),
    ).toBe('2026-05-01T00:00:00.000Z');
    expect(
      periodRange(
        QuotaPeriod.YEAR,
        new Date('2026-05-17Z'),
      ).start.toISOString(),
    ).toBe('2026-01-01T00:00:00.000Z');
  });

  it('a won deal is closed and a lost one is omitted, whatever the rep said', () => {
    expect(
      deriveCategory({
        status: 'won',
        forecastCategory: ForecastCategory.PIPELINE,
        probability: 10,
      }),
    ).toBe(ForecastCategory.CLOSED);
    expect(
      deriveCategory({
        status: 'lost',
        forecastCategory: ForecastCategory.COMMIT,
        probability: 90,
      }),
    ).toBe(ForecastCategory.OMITTED);
  });

  it("uses the rep's own call on an open deal", () => {
    expect(
      deriveCategory({
        status: 'open',
        forecastCategory: ForecastCategory.COMMIT,
        probability: 10,
      }),
    ).toBe(ForecastCategory.COMMIT);
  });

  it('falls back to the stage probability when nobody has said', () => {
    const at = (probability: number) =>
      deriveCategory({ status: 'open', forecastCategory: null, probability });

    expect(at(80)).toBe(ForecastCategory.COMMIT);
    expect(at(50)).toBe(ForecastCategory.BEST_CASE);
    expect(at(10)).toBe(ForecastCategory.PIPELINE);
  });
});

describe('ForecastService', () => {
  let service: ForecastService;
  let prisma: any;

  const deal = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    value: 100,
    status: 'open',
    forecastCategory: null,
    ownerId: 'u1',
    expectedAt: new Date(),
    owner: { id: 'u1', firstName: 'Ravi', lastName: 'Rep' },
    stage: { probability: 50 },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      quota: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => data),
        update: jest.fn().mockImplementation(({ data }: any) => data),
        deleteMany: jest.fn(),
      },
      deal: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { value: 0 } }),
      },
      forecastSnapshot: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ForecastService,
        { provide: PrismaService, useValue: prisma },
        { provide: TerritoriesService, useValue: { subtree: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(ForecastService);
  });

  it('refuses a quota that belongs to both a person and a territory', async () => {
    await expect(
      service.upsertQuota(tenantId, {
        ownerId: 'u1',
        territoryId: 't1',
        period: QuotaPeriod.QUARTER,
        periodStart: '2026-04-01',
        amount: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a quota that belongs to neither', async () => {
    await expect(
      service.upsertQuota(tenantId, {
        period: QuotaPeriod.QUARTER,
        periodStart: '2026-04-01',
        amount: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replaces a quota rather than leaving a rep with two numbers', async () => {
    prisma.quota.findFirst.mockResolvedValue({ id: 'q1' });

    await service.upsertQuota(tenantId, {
      ownerId: 'u1',
      period: QuotaPeriod.QUARTER,
      periodStart: '2026-05-17',
      amount: 500,
    });

    expect(prisma.quota.create).not.toHaveBeenCalled();
    expect(prisma.quota.update.mock.calls[0][0].data.amount).toBe(500);
  });

  it('snaps the quota to the start of its period', async () => {
    await service.upsertQuota(tenantId, {
      ownerId: 'u1',
      period: QuotaPeriod.QUARTER,
      periodStart: '2026-05-17',
      amount: 500,
    });

    expect(
      (
        prisma.quota.create.mock.calls[0][0].data.periodStart as Date
      ).toISOString(),
    ).toBe('2026-04-01T00:00:00.000Z');
  });

  it('splits a period into categories and weights the open pipeline', async () => {
    prisma.deal.findMany.mockResolvedValue([
      deal({ id: 'a', value: 1000, status: 'won' }),
      deal({ id: 'b', value: 400, stage: { probability: 80 } }),
      deal({ id: 'c', value: 200, stage: { probability: 50 } }),
      deal({ id: 'd', value: 100, stage: { probability: 10 } }),
    ]);

    const result = await service.forecast(tenantId, {});
    const row = result.rows[0];

    expect(row.closed).toBe(1000);
    expect(row.commit).toBe(400);
    expect(row.bestCase).toBe(200);
    expect(row.pipeline).toBe(100);
    // 1000 won + 400*0.8 + 200*0.5 + 100*0.1
    expect(row.weighted).toBe(1430);
  });

  it('reports the gap to quota on what is committed, not on hope', async () => {
    prisma.deal.findMany.mockResolvedValue([
      deal({ id: 'a', value: 600, status: 'won' }),
      deal({ id: 'b', value: 200, stage: { probability: 80 } }),
      deal({ id: 'c', value: 900, stage: { probability: 10 } }),
    ]);
    prisma.quota.findMany.mockResolvedValue([
      { ownerId: 'u1', territoryId: null, amount: 1000 },
    ]);

    const row = (await service.forecast(tenantId, {})).rows[0];

    expect(row.attainment).toBe(60); // 600 closed of 1000
    expect(row.gap).toBe(200); // 1000 - (600 closed + 200 commit)
  });

  it('keeps a quota holder on the sheet even with nothing in the period', async () => {
    prisma.deal.findMany.mockResolvedValue([]);
    prisma.quota.findMany.mockResolvedValue([
      { ownerId: 'u2', territoryId: null, amount: 1000 },
    ]);
    prisma.user = {
      findFirst: jest
        .fn()
        .mockResolvedValue({ firstName: 'Sara', lastName: 'Seller' }),
    };

    const result = await service.forecast(tenantId, {});

    // At zero they are exactly the rep a manager is looking for.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      owner: 'Sara Seller',
      quota: 1000,
      closed: 0,
      gap: 1000,
    });
  });

  it('does not count a rep quota and a territory quota as two targets', async () => {
    prisma.quota.findMany.mockResolvedValue([
      { ownerId: 'u1', territoryId: null, amount: 600 },
      { ownerId: null, territoryId: 't1', amount: 1000 },
    ]);
    prisma.user = { findFirst: jest.fn().mockResolvedValue(null) };

    const team = await service.forecast(tenantId, {});
    expect(team.total.quota).toBe(600);

    const territory = await service.forecast(tenantId, { territoryId: 't1' });
    expect(territory.total.quota).toBe(1000);
  });

  it('counts open deals with no expected date separately', async () => {
    prisma.deal.count.mockResolvedValue(7);

    const result = await service.forecast(tenantId, {});

    // They belong to no period; forecasting them into this one would be a lie.
    expect(result.dealsWithoutExpectedDate).toBe(7);
  });

  it('a what-if changes the projection and nothing else', async () => {
    prisma.deal.findMany.mockResolvedValue([
      deal({ id: 'a', value: 1000, status: 'won' }),
      deal({ id: 'b', value: 1000, stage: { probability: 80 } }),
    ]);

    const optimistic = await service.whatIf(tenantId, { commitOdds: 1 });
    const gloomy = await service.whatIf(tenantId, { commitOdds: 0 });

    expect(optimistic.total.projected).toBe(2000);
    expect(gloomy.total.projected).toBe(1000);
    // Nothing is written: it answers "what would it take", not "make it so".
    expect(prisma.deal.update).not.toHaveBeenCalled();
  });

  it('scores accuracy against the first call of the period, not the last', async () => {
    const periodStart = new Date('2020-01-01T00:00:00Z');
    prisma.forecastSnapshot.findMany.mockResolvedValue([
      {
        ownerId: 'u1',
        period: QuotaPeriod.QUARTER,
        periodStart,
        takenAt: new Date('2020-01-05Z'),
        closed: 0,
        commit: 1000,
        owner: { id: 'u1', firstName: 'Ravi', lastName: 'Rep' },
      },
      {
        ownerId: 'u1',
        period: QuotaPeriod.QUARTER,
        periodStart,
        takenAt: new Date('2020-03-30Z'),
        closed: 800,
        commit: 0,
        owner: { id: 'u1', firstName: 'Ravi', lastName: 'Rep' },
      },
    ]);
    prisma.deal.aggregate.mockResolvedValue({ _sum: { value: 800 } });

    const [row] = await service.accuracy(tenantId);

    expect(row.called).toBe(1000);
    expect(row.actual).toBe(800);
    expect(row.accuracy).toBe(80);
  });

  it('does not score a period that is still running', async () => {
    prisma.forecastSnapshot.findMany.mockResolvedValue([
      {
        ownerId: 'u1',
        period: QuotaPeriod.YEAR,
        periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
        takenAt: new Date(),
        closed: 0,
        commit: 500,
        owner: { id: 'u1', firstName: 'Ravi', lastName: 'Rep' },
      },
    ]);

    expect(await service.accuracy(tenantId)).toHaveLength(0);
  });
});

describe('GamificationService', () => {
  let service: GamificationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', firstName: 'Ravi', lastName: 'Rep' },
          { id: 'u2', firstName: 'Sara', lastName: 'Seller' },
        ]),
      },
      deal: { groupBy: jest.fn().mockResolvedValue([]) },
      activity: { groupBy: jest.fn().mockResolvedValue([]) },
      ticket: { groupBy: jest.fn().mockResolvedValue([]) },
      contest: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      badge: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      userBadge: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GamificationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(GamificationService);
  });

  it('weights revenue against activity so a big deal outranks a call spree', () => {
    const closer = scoreOf({
      revenueWon: 500_000,
      dealsWon: 2,
      callsMade: 0,
      meetingsHeld: 0,
      ticketsResolved: 0,
    });
    const dialler = scoreOf({
      revenueWon: 0,
      dealsWon: 0,
      callsMade: 200,
      meetingsHeld: 10,
      ticketsResolved: 0,
    });

    expect(closer).toBeGreaterThan(dialler);
  });

  it('keeps everyone on the board, including those with nothing yet', async () => {
    const rows = await service.standings(tenantId);

    // A board that hides the bottom half is a highlight reel, not a standing.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.points === 0)).toBe(true);
  });

  it('counts each metric from its own records', async () => {
    prisma.deal.groupBy.mockResolvedValue([
      { ownerId: 'u1', _sum: { value: 100_000 }, _count: { _all: 3 } },
    ]);
    prisma.activity.groupBy.mockResolvedValue([
      { userId: 'u1', type: 'CALL', _count: { _all: 12 } },
      { userId: 'u2', type: 'MEETING', _count: { _all: 4 } },
    ]);
    prisma.ticket.groupBy.mockResolvedValue([
      { assigneeId: 'u2', _count: { _all: 6 } },
    ]);

    const rows = await service.standings(tenantId);
    const ravi = rows.find((r) => r.userId === 'u1')!;
    const sara = rows.find((r) => r.userId === 'u2')!;

    expect(ravi).toMatchObject({
      revenueWon: 100_000,
      dealsWon: 3,
      callsMade: 12,
    });
    expect(sara).toMatchObject({ meetingsHeld: 4, ticketsResolved: 6 });
    expect(rows[0].userId).toBe('u1'); // sorted by points
  });

  it('ranks a contest on its own metric over its own window', async () => {
    prisma.contest.findFirst.mockResolvedValue({
      id: 'c1',
      metric: ContestMetric.CALLS_MADE,
      startsAt: new Date('2026-01-01Z'),
      endsAt: new Date('2026-02-01Z'),
    });
    prisma.deal.groupBy.mockResolvedValue([
      { ownerId: 'u1', _sum: { value: 999_999 }, _count: { _all: 9 } },
    ]);
    prisma.activity.groupBy.mockResolvedValue([
      { userId: 'u2', type: 'CALL', _count: { _all: 30 } },
    ]);

    const result = await service.contestStandings(tenantId, 'c1');

    // The contest is about calls, so the revenue leader does not win it.
    expect(result.rows[0]).toMatchObject({
      rank: 1,
      name: 'Sara Seller',
      value: 30,
    });
    const range = prisma.deal.groupBy.mock.calls[0][0].where.closedAt;
    expect(range.gte).toEqual(new Date('2026-01-01Z'));
    expect(range.lt).toEqual(new Date('2026-02-01Z'));
  });

  it('awards a badge once and records what earned it', async () => {
    prisma.badge.findMany.mockResolvedValue([
      {
        id: 'b1',
        metric: ContestMetric.DEALS_WON,
        threshold: 3,
      },
    ]);
    prisma.deal.groupBy.mockResolvedValue([
      { ownerId: 'u1', _sum: { value: 10 }, _count: { _all: 5 } },
    ]);

    const result = await service.awardBadges(tenantId);

    expect(result.awarded).toBe(1);
    expect(prisma.userBadge.create.mock.calls[0][0].data).toMatchObject({
      userId: 'u1',
      badgeId: 'b1',
      value: 5,
    });
  });

  it('does not award the same badge twice', async () => {
    prisma.badge.findMany.mockResolvedValue([
      { id: 'b1', metric: ContestMetric.DEALS_WON, threshold: 3 },
    ]);
    prisma.deal.groupBy.mockResolvedValue([
      { ownerId: 'u1', _sum: { value: 10 }, _count: { _all: 5 } },
    ]);
    prisma.userBadge.findMany.mockResolvedValue([
      { userId: 'u1', badgeId: 'b1' },
    ]);

    expect(await service.awardBadges(tenantId)).toEqual({ awarded: 0 });
    expect(prisma.userBadge.create).not.toHaveBeenCalled();
  });
});
