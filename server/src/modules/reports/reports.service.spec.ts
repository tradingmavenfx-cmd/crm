import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';

const CONFIG: Record<string, unknown> = {
  'reports.slaFirstResponseMinutes': 60,
};

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      dealStage: { findMany: jest.fn().mockResolvedValue([]) },
      deal: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      campaign: { findMany: jest.fn().mockResolvedValue([]) },
      conversation: { findMany: jest.fn().mockResolvedValue([]) },
      message: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      emailEvent: { groupBy: jest.fn().mockResolvedValue([]) },
      call: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => CONFIG[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(ReportsService);
  });

  it('rejects an unknown report key', async () => {
    await expect(service.run(tenantId, 'nope.nothing')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lists every report with its family and chart options', () => {
    const reports = service.listReports();
    expect(reports.length).toBeGreaterThan(10);
    expect(new Set(reports.map((r) => r.family))).toEqual(
      new Set(['sales', 'marketing', 'service', 'communication']),
    );
    expect(reports.every((r) => r.charts.length > 0)).toBe(true);
  });

  // ── Sales ──────────────────────────────────────

  it('totals open deals per stage, keeping empty stages visible', async () => {
    prisma.dealStage.findMany.mockResolvedValue([
      { id: 's1', name: 'Qualified', order: 0, probability: 25 },
      { id: 's2', name: 'Proposal', order: 1, probability: 50 },
    ]);
    prisma.deal.findMany.mockResolvedValue([
      { stageId: 's1', value: 100 },
      { stageId: 's1', value: 400 },
    ]);

    const report = await service.run(tenantId, 'sales.pipeline');

    expect(report.rows).toEqual([
      { stage: 'Qualified', probability: 25, deals: 2, value: 500 },
      { stage: 'Proposal', probability: 50, deals: 0, value: 0 },
    ]);
    expect(report.stats).toContainEqual({
      label: 'Pipeline value',
      value: 500,
    });
  });

  it('weights the forecast by stage probability and buckets by month', async () => {
    prisma.dealStage.findMany.mockResolvedValue([
      { id: 's1', name: 'Proposal', probability: 50 },
    ]);
    prisma.deal.findMany.mockResolvedValue([
      { stageId: 's1', value: 1000, expectedAt: new Date('2026-10-15') },
      { stageId: 's1', value: 500, expectedAt: null },
    ]);

    const report = await service.run(tenantId, 'sales.forecast');

    expect(report.rows).toContainEqual({
      month: '2026-10',
      deals: 1,
      value: 1000,
      weighted: 500,
    });
    // A deal with no expected date must still appear, not vanish silently.
    expect(report.rows).toContainEqual({
      month: 'Unscheduled',
      deals: 1,
      value: 500,
      weighted: 250,
    });
  });

  it('ranks the leaderboard by won revenue', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', firstName: 'Ravi', lastName: 'Rep' },
      { id: 'u2', firstName: 'Ada', lastName: 'Admin' },
    ]);
    prisma.deal.findMany.mockResolvedValue([
      { ownerId: 'u1', status: 'won', value: 100 },
      { ownerId: 'u2', status: 'won', value: 900 },
      { ownerId: 'u1', status: 'open', value: 50 },
    ]);

    const report = await service.run(tenantId, 'sales.leaderboard');

    expect(report.rows[0]).toMatchObject({ rep: 'Ada Admin', revenue: 900 });
    expect(report.rows[1]).toMatchObject({
      rep: 'Ravi Rep',
      revenue: 100,
      pipeline: 50,
    });
  });

  it('computes the win rate', async () => {
    prisma.deal.findMany.mockResolvedValue([
      { status: 'won', value: 100 },
      { status: 'won', value: 100 },
      { status: 'lost', value: 50 },
    ]);

    const report = await service.run(tenantId, 'sales.win_loss');

    expect(report.stats).toContainEqual({ label: 'Win rate', value: '67%' });
  });

  it('shows a dash for the win rate when nothing has closed', async () => {
    const report = await service.run(tenantId, 'sales.win_loss');
    expect(report.stats).toContainEqual({ label: 'Win rate', value: '—' });
  });

  it('measures the sales cycle from creation to close', async () => {
    const created = new Date('2026-01-01');
    prisma.deal.findMany.mockResolvedValue([
      { status: 'won', createdAt: created, closedAt: new Date('2026-01-11') },
      { status: 'won', createdAt: created, closedAt: new Date('2026-01-21') },
    ]);

    const report = await service.run(tenantId, 'sales.cycle');

    expect(report.rows[0]).toMatchObject({
      outcome: 'won',
      deals: 2,
      avgDays: 15,
    });
  });

  // ── Service ────────────────────────────────────

  it('reports first response time and SLA compliance per channel', async () => {
    const opened = new Date(Date.now() - 2 * DAY);
    const inbound = (at: Date) => [{ direction: 'INBOUND', createdAt: at }];
    prisma.conversation.findMany.mockResolvedValue([
      {
        channel: 'SMS',
        firstResponseAt: new Date(opened.getTime() + 10 * MIN),
        messages: inbound(opened),
      },
      {
        channel: 'SMS',
        firstResponseAt: new Date(opened.getTime() + 120 * MIN),
        messages: inbound(opened),
      },
    ]);

    const report = await service.run(tenantId, 'service.first_response');

    expect(report.rows[0]).toMatchObject({
      channel: 'SMS',
      conversations: 2,
      avgMinutes: 65,
      slaPercent: 50,
    });
    expect(report.columns.at(-1)?.label).toBe('Within 60m %');
  });

  it('ignores threads we started - there was nothing to respond to', async () => {
    const opened = new Date(Date.now() - 2 * DAY);
    prisma.conversation.findMany.mockResolvedValue([
      {
        channel: 'SMS',
        firstResponseAt: opened,
        messages: [{ direction: 'OUTBOUND', createdAt: opened }],
      },
    ]);

    const report = await service.run(tenantId, 'service.first_response');

    // An outbound-initiated thread would otherwise contribute a bogus zero.
    expect(report.rows).toHaveLength(0);
    expect(report.stats).toContainEqual({ label: 'Overall avg', value: '—' });
  });

  it('drops a response recorded before the message it answers', async () => {
    const opened = new Date(Date.now() - 2 * DAY);
    prisma.conversation.findMany.mockResolvedValue([
      {
        channel: 'WHATSAPP',
        // Backfilled data can put the response before the message; a negative
        // duration must never reach the average.
        firstResponseAt: new Date(opened.getTime() - 30 * MIN),
        messages: [{ direction: 'INBOUND', createdAt: opened }],
      },
      {
        channel: 'WHATSAPP',
        firstResponseAt: new Date(opened.getTime() + 20 * MIN),
        messages: [{ direction: 'INBOUND', createdAt: opened }],
      },
    ]);

    const report = await service.run(tenantId, 'service.first_response');

    expect(report.rows[0]).toMatchObject({ conversations: 1, avgMinutes: 20 });
  });

  it('scores chat satisfaction and the promoter balance', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { rating: 5 },
      { rating: 5 },
      { rating: 4 },
      { rating: 1 },
    ]);

    const report = await service.run(tenantId, 'service.csat');

    expect(report.stats).toContainEqual({ label: 'Responses', value: 4 });
    expect(report.stats).toContainEqual({ label: 'Average', value: '3.8 / 5' });
    // 3 promoters, 1 detractor, over 4 responses.
    expect(report.stats).toContainEqual({
      label: 'NPS-style score',
      value: 50,
    });
  });

  it('counts open and overdue tasks per assignee', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', firstName: 'Ravi', lastName: 'Rep' },
    ]);
    prisma.task.findMany.mockResolvedValue([
      { assigneeId: 'u1', status: 'open', dueAt: new Date(Date.now() - DAY) },
      { assigneeId: 'u1', status: 'open', dueAt: new Date(Date.now() + DAY) },
      { assigneeId: 'u1', status: 'done', dueAt: null },
      { assigneeId: null, status: 'open', dueAt: null },
    ]);

    const report = await service.run(tenantId, 'activity.tasks');

    expect(report.rows[0]).toMatchObject({
      assignee: 'Ravi Rep',
      open: 2,
      overdue: 1,
      done: 1,
    });
    // Unassigned work is surfaced rather than dropped.
    expect(report.rows.at(-1)).toMatchObject({
      assignee: 'Unassigned',
      open: 1,
    });
  });

  // ── Communication ──────────────────────────────

  it('summarises calls with an answer rate', async () => {
    prisma.call.findMany.mockResolvedValue([
      { status: 'COMPLETED', direction: 'INBOUND', durationSec: 120 },
      { status: 'MISSED', direction: 'INBOUND', durationSec: 0 },
      { status: 'VOICEMAIL', direction: 'INBOUND', durationSec: 30 },
      { status: 'COMPLETED', direction: 'OUTBOUND', durationSec: 60 },
    ]);

    const report = await service.run(tenantId, 'comms.calls');

    expect(report.stats).toContainEqual({ label: 'Total calls', value: 4 });
    expect(report.stats).toContainEqual({ label: 'Answer rate', value: '50%' });
    expect(report.stats).toContainEqual({ label: 'Talk time', value: '4 min' });
  });

  it('builds a dense day series for omnichannel volume', async () => {
    prisma.message.findMany.mockResolvedValue([
      { channel: 'SMS', direction: 'INBOUND', createdAt: new Date() },
    ]);

    const report = await service.run(tenantId, 'comms.omnichannel', {
      days: 7,
    });

    // Every day in the window appears, even the quiet ones.
    expect(report.rows).toHaveLength(7);
    expect(report.rows.at(-1)).toMatchObject({ inbound: 1, outbound: 0 });
  });

  it('splits message volume by channel and direction', async () => {
    prisma.message.groupBy.mockResolvedValue([
      { channel: 'SMS', direction: 'INBOUND', _count: { _all: 3 } },
      { channel: 'SMS', direction: 'OUTBOUND', _count: { _all: 5 } },
      { channel: 'EMAIL', direction: 'OUTBOUND', _count: { _all: 2 } },
    ]);

    const report = await service.run(tenantId, 'comms.volume_by_channel');

    expect(report.rows[0]).toEqual({
      channel: 'SMS',
      inbound: 3,
      outbound: 5,
      total: 8,
    });
  });

  // ── Export ─────────────────────────────────────

  it('exports CSV, quoting values that contain separators', () => {
    const csv = service.toCsv({
      key: 'x',
      name: 'X',
      generatedAt: new Date().toISOString(),
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'note', label: 'Note' },
      ],
      rows: [
        { name: 'Acme, Inc', note: 'He said "hi"' },
        { name: 'Plain', note: null },
      ],
    });

    expect(csv.split('\n')).toEqual([
      'Name,Note',
      '"Acme, Inc","He said ""hi"""',
      'Plain,',
    ]);
  });
});
