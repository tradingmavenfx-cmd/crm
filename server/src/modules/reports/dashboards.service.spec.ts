import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DashboardsService } from './dashboards.service';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

const report = {
  key: 'sales.pipeline',
  name: 'Pipeline by stage',
  generatedAt: new Date().toISOString(),
  columns: [
    { key: 'stage', label: 'Stage' },
    { key: 'deals', label: 'Deals' },
  ],
  rows: [{ stage: 'Qualified', deals: 2 }],
  stats: [{ label: 'Open deals', value: 2 }],
};

describe('DashboardsService', () => {
  let service: DashboardsService;
  let prisma: any;
  let reports: { run: jest.Mock };
  let email: { send: jest.Mock };
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      dashboard: {
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'd1' }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'd1' }),
        update: jest.fn().mockResolvedValue({ id: 'd1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
      },
      dashboardWidget: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'w1' }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
      reportSchedule: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 's1' }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    reports = { run: jest.fn().mockResolvedValue(report) };
    email = { send: jest.fn().mockResolvedValue({ id: 'm1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReportsService, useValue: reports },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = moduleRef.get(DashboardsService);
  });

  // ── Visibility ─────────────────────────────────

  it('lists dashboards open to everyone or to this role', async () => {
    await service.listDashboards(tenantId, Role.SALES_REP);

    const where = prisma.dashboard.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { visibleToRoles: { isEmpty: true } },
      { visibleToRoles: { has: Role.SALES_REP } },
    ]);
  });

  it('hides a restricted dashboard behind the same error as a missing one', async () => {
    prisma.dashboard.findFirst.mockResolvedValue({
      id: 'd1',
      tenantId,
      visibleToRoles: [Role.TENANT_ADMIN],
      widgets: [],
    });

    await expect(
      service.getDashboard(tenantId, 'd1', Role.SALES_REP),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a permitted role open a restricted dashboard', async () => {
    prisma.dashboard.findFirst.mockResolvedValue({
      id: 'd1',
      tenantId,
      visibleToRoles: [Role.TENANT_ADMIN],
      widgets: [],
    });

    await expect(
      service.getDashboard(tenantId, 'd1', Role.TENANT_ADMIN),
    ).resolves.toMatchObject({ id: 'd1' });
  });

  // ── Rendering ──────────────────────────────────

  it('renders every widget with its computed report', async () => {
    prisma.dashboard.findFirst.mockResolvedValue({
      id: 'd1',
      tenantId,
      visibleToRoles: [],
      widgets: [
        { id: 'w1', reportKey: 'sales.pipeline', params: {} },
        { id: 'w2', reportKey: 'sales.forecast', params: { days: 30 } },
      ],
    });

    const rendered = await service.renderDashboard(
      tenantId,
      'd1',
      Role.MANAGER,
    );

    expect(rendered.widgets).toHaveLength(2);
    expect(rendered.widgets[0].report).toMatchObject({ key: 'sales.pipeline' });
    expect(reports.run).toHaveBeenCalledWith(tenantId, 'sales.forecast', {
      days: 30,
    });
  });

  it('keeps the dashboard usable when one widget fails', async () => {
    prisma.dashboard.findFirst.mockResolvedValue({
      id: 'd1',
      tenantId,
      visibleToRoles: [],
      widgets: [
        { id: 'w1', reportKey: 'sales.pipeline', params: {} },
        { id: 'w2', reportKey: 'broken', params: {} },
      ],
    });
    reports.run
      .mockResolvedValueOnce(report)
      .mockRejectedValueOnce(new Error('Unknown report: broken'));

    const rendered = await service.renderDashboard(
      tenantId,
      'd1',
      Role.MANAGER,
    );

    expect(rendered.widgets[0].error).toBeNull();
    expect(rendered.widgets[1].error).toBe('Unknown report: broken');
    expect(rendered.widgets[1].report).toBeNull();
  });

  // ── Widgets ────────────────────────────────────

  it('rejects a widget pointing at an unknown report', async () => {
    prisma.dashboard.findFirst.mockResolvedValue({ id: 'd1', tenantId });

    await expect(
      service.addWidget(tenantId, 'd1', { title: 'X', reportKey: 'nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('appends a new widget after the last position', async () => {
    prisma.dashboard.findFirst.mockResolvedValue({ id: 'd1', tenantId });
    prisma.dashboardWidget.findFirst.mockResolvedValue({ position: 3 });

    await service.addWidget(tenantId, 'd1', {
      title: 'Pipeline',
      reportKey: 'sales.pipeline',
    });

    expect(prisma.dashboardWidget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ position: 4 }),
    });
  });

  it('refuses a reorder that names a widget from another dashboard', async () => {
    prisma.dashboardWidget.findMany.mockResolvedValue([{ id: 'w1' }]);

    await expect(
      service.reorderWidgets(tenantId, 'd1', ['w1', 'intruder']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes positions in the order given', async () => {
    prisma.dashboardWidget.findMany.mockResolvedValue([
      { id: 'w1' },
      { id: 'w2' },
    ]);

    await service.reorderWidgets(tenantId, 'd1', ['w2', 'w1']);

    expect(prisma.dashboardWidget.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'w2' },
      data: { position: 0 },
    });
    expect(prisma.dashboardWidget.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'w1' },
      data: { position: 1 },
    });
  });

  it('keeps only one default dashboard', async () => {
    await service.createDashboard(tenantId, 'u1', {
      name: 'Sales',
      isDefault: true,
    });

    expect(prisma.dashboard.updateMany).toHaveBeenCalledWith({
      where: { tenantId, isDefault: true, id: undefined },
      data: { isDefault: false },
    });
  });

  // ── Scheduled emails ───────────────────────────

  it('emails the report to every recipient and stamps the send', async () => {
    prisma.reportSchedule.findFirst.mockResolvedValue({
      id: 's1',
      tenantId,
      name: 'Monday pipeline',
      reportKey: 'sales.pipeline',
      recipients: ['a@acme.com', 'b@acme.com'],
      params: {},
    });

    const result = await service.sendSchedule(tenantId, 's1');

    expect(email.send).toHaveBeenCalledTimes(2);
    const sent = email.send.mock.calls[0][1];
    expect(sent.subject).toBe('Monday pipeline — Pipeline by stage');
    expect(sent.html).toContain('Qualified');
    expect(result).toEqual({ sent: 2, report: 'sales.pipeline' });
    expect(prisma.reportSchedule.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { lastSentAt: expect.any(Date) },
    });
  });

  it('escapes report values in the email HTML', async () => {
    reports.run.mockResolvedValue({
      ...report,
      rows: [{ stage: '<script>alert(1)</script>', deals: 1 }],
    });
    prisma.reportSchedule.findFirst.mockResolvedValue({
      id: 's1',
      tenantId,
      name: 'X',
      reportKey: 'sales.pipeline',
      recipients: ['a@acme.com'],
      params: {},
    });

    await service.sendSchedule(tenantId, 's1');

    const html = email.send.mock.calls[0][1].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects a schedule for an unknown report', () => {
    expect(() =>
      service.createSchedule(tenantId, {
        name: 'X',
        reportKey: 'nope',
        recipients: ['a@acme.com'],
      }),
    ).toThrow(BadRequestException);
  });

  it('only sends a weekly schedule once a week', async () => {
    const now = new Date();
    prisma.reportSchedule.findMany.mockResolvedValue([
      {
        id: 's1',
        tenantId,
        name: 'Weekly',
        reportKey: 'sales.pipeline',
        frequency: 'weekly',
        recipients: ['a@acme.com'],
        params: {},
        lastSentAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    ]);

    await service.runSchedules();

    expect(email.send).not.toHaveBeenCalled();
  });

  it('sends a daily schedule that has not gone out today', async () => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes(),
    ).padStart(2, '0')}`;
    prisma.reportSchedule.findMany.mockResolvedValue([
      {
        id: 's1',
        tenantId,
        name: 'Daily',
        reportKey: 'sales.pipeline',
        frequency: 'daily',
        sendAt: hhmm,
        recipients: ['a@acme.com'],
        params: {},
        lastSentAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
      },
    ]);

    await service.runSchedules();

    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('scopes schedule lookups to the tenant', async () => {
    prisma.reportSchedule.findFirst.mockResolvedValue(null);
    await expect(
      service.sendSchedule(tenantId, 'other'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
