import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ReportsService, ReportResult } from './reports.service';
import { REPORT_KEYS } from './report-registry';
import {
  CreateDashboardDto,
  CreateScheduleDto,
  CreateWidgetDto,
  UpdateDashboardDto,
  UpdateScheduleDto,
  UpdateWidgetDto,
} from './dto/reports.dto';

@Injectable()
export class DashboardsService {
  private readonly logger = new Logger('DashboardsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly email: EmailService,
  ) {}

  private assertReportKey(key: string) {
    if (!REPORT_KEYS.includes(key)) {
      throw new BadRequestException(`Unknown report: ${key}`);
    }
  }

  // ── Dashboards ───────────────────────────────

  /** Dashboards this role is allowed to open. */
  listDashboards(tenantId: string, role: Role) {
    return this.prisma.dashboard.findMany({
      where: {
        tenantId,
        // An empty role list means "everyone", which `hasSome` cannot express.
        OR: [
          { visibleToRoles: { isEmpty: true } },
          { visibleToRoles: { has: role } },
        ],
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { widgets: { orderBy: { position: 'asc' } } },
    });
  }

  async getDashboard(tenantId: string, id: string, role: Role) {
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id, tenantId },
      include: { widgets: { orderBy: { position: 'asc' } } },
    });
    if (!dashboard) throw new NotFoundException('Dashboard not found');

    if (
      dashboard.visibleToRoles.length &&
      !dashboard.visibleToRoles.includes(role)
    ) {
      // Same shape as a missing dashboard, so visibility cannot be probed.
      throw new NotFoundException('Dashboard not found');
    }
    return dashboard;
  }

  /** A dashboard with every widget's report already computed. */
  async renderDashboard(tenantId: string, id: string, role: Role) {
    const dashboard = await this.getDashboard(tenantId, id, role);

    const widgets = await Promise.all(
      dashboard.widgets.map(async (widget) => {
        try {
          const report = await this.reports.run(
            tenantId,
            widget.reportKey,
            widget.params as { days?: number },
          );
          return { ...widget, report, error: null as string | null };
        } catch (err) {
          // One broken widget must not blank the whole dashboard.
          return {
            ...widget,
            report: null as ReportResult | null,
            error: err instanceof Error ? err.message : 'Report failed',
          };
        }
      }),
    );

    return { ...dashboard, widgets };
  }

  async createDashboard(
    tenantId: string,
    userId: string,
    dto: CreateDashboardDto,
  ) {
    if (dto.isDefault) await this.clearDefault(tenantId);
    return this.prisma.dashboard.create({
      data: {
        tenantId,
        createdById: userId,
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        visibleToRoles: dto.visibleToRoles ?? [],
      },
      include: { widgets: true },
    });
  }

  async updateDashboard(tenantId: string, id: string, dto: UpdateDashboardDto) {
    await this.prisma.dashboard
      .findFirstOrThrow({
        where: { id, tenantId },
      })
      .catch(() => {
        throw new NotFoundException('Dashboard not found');
      });

    if (dto.isDefault) await this.clearDefault(tenantId, id);

    return this.prisma.dashboard.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault,
        visibleToRoles: dto.visibleToRoles,
      },
      include: { widgets: { orderBy: { position: 'asc' } } },
    });
  }

  private clearDefault(tenantId: string, exceptId?: string) {
    return this.prisma.dashboard.updateMany({
      where: {
        tenantId,
        isDefault: true,
        id: exceptId ? { not: exceptId } : undefined,
      },
      data: { isDefault: false },
    });
  }

  async removeDashboard(tenantId: string, id: string) {
    const existing = await this.prisma.dashboard.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Dashboard not found');
    await this.prisma.dashboard.delete({ where: { id } });
    return { success: true };
  }

  // ── Widgets ──────────────────────────────────

  async addWidget(tenantId: string, dashboardId: string, dto: CreateWidgetDto) {
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id: dashboardId, tenantId },
    });
    if (!dashboard) throw new NotFoundException('Dashboard not found');
    this.assertReportKey(dto.reportKey);

    const last = await this.prisma.dashboardWidget.findFirst({
      where: { dashboardId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.dashboardWidget.create({
      data: {
        tenantId,
        dashboardId,
        title: dto.title,
        reportKey: dto.reportKey,
        chart: dto.chart ?? 'bar',
        params: (dto.params ?? {}) as unknown as Prisma.InputJsonValue,
        width: dto.width ?? 'half',
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  async updateWidget(tenantId: string, id: string, dto: UpdateWidgetDto) {
    const widget = await this.prisma.dashboardWidget.findFirst({
      where: { id, tenantId },
    });
    if (!widget) throw new NotFoundException('Widget not found');

    return this.prisma.dashboardWidget.update({
      where: { id },
      data: {
        title: dto.title,
        chart: dto.chart,
        width: dto.width,
        position: dto.position,
        params: dto.params
          ? (dto.params as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async removeWidget(tenantId: string, id: string) {
    const widget = await this.prisma.dashboardWidget.findFirst({
      where: { id, tenantId },
    });
    if (!widget) throw new NotFoundException('Widget not found');
    await this.prisma.dashboardWidget.delete({ where: { id } });
    return { success: true };
  }

  /** Positions follow the order of the ids sent. */
  async reorderWidgets(tenantId: string, dashboardId: string, ids: string[]) {
    const widgets = await this.prisma.dashboardWidget.findMany({
      where: { tenantId, dashboardId },
      select: { id: true },
    });
    const known = new Set(widgets.map((w) => w.id));
    if (ids.some((id) => !known.has(id))) {
      throw new BadRequestException(
        'Widget list does not match this dashboard',
      );
    }

    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.dashboardWidget.update({
          where: { id },
          data: { position },
        }),
      ),
    );
    return { success: true };
  }

  // ── Scheduled report emails ──────────────────

  listSchedules(tenantId: string) {
    return this.prisma.reportSchedule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createSchedule(tenantId: string, dto: CreateScheduleDto) {
    this.assertReportKey(dto.reportKey);
    return this.prisma.reportSchedule.create({
      data: {
        tenantId,
        name: dto.name,
        reportKey: dto.reportKey,
        frequency: dto.frequency ?? 'weekly',
        sendAt: dto.sendAt ?? '09:00',
        recipients: dto.recipients,
        params: (dto.params ?? {}) as unknown as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateSchedule(tenantId: string, id: string, dto: UpdateScheduleDto) {
    const existing = await this.prisma.reportSchedule.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Schedule not found');

    return this.prisma.reportSchedule.update({
      where: { id },
      data: {
        name: dto.name,
        frequency: dto.frequency,
        sendAt: dto.sendAt,
        recipients: dto.recipients,
        isActive: dto.isActive,
      },
    });
  }

  async removeSchedule(tenantId: string, id: string) {
    const existing = await this.prisma.reportSchedule.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Schedule not found');
    await this.prisma.reportSchedule.delete({ where: { id } });
    return { success: true };
  }

  /** Sends one schedule now, whatever its cadence says. */
  async sendSchedule(tenantId: string, id: string) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id, tenantId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return this.deliver(schedule);
  }

  private async deliver(schedule: {
    id: string;
    tenantId: string;
    name: string;
    reportKey: string;
    recipients: string[];
    params: Prisma.JsonValue;
  }) {
    const report = await this.reports.run(
      schedule.tenantId,
      schedule.reportKey,
      (schedule.params ?? {}) as { days?: number },
    );

    const html = this.renderHtml(report);
    for (const to of schedule.recipients) {
      await this.email.send(schedule.tenantId, {
        to,
        subject: `${schedule.name} — ${report.name}`,
        html,
      });
    }

    await this.prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: { lastSentAt: new Date() },
    });

    return { sent: schedule.recipients.length, report: report.key };
  }

  /** The report as a plain HTML table, which every mail client can render. */
  private renderHtml(report: ReportResult): string {
    const escape = (value: unknown) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const stats = (report.stats ?? [])
      .map(
        (s) =>
          `<td style="padding:8px 16px;border:1px solid #e2e8f0"><div style="font-size:11px;color:#64748b;text-transform:uppercase">${escape(
            s.label,
          )}</div><div style="font-size:20px;font-weight:700">${escape(
            s.value,
          )}</div></td>`,
      )
      .join('');

    const header = report.columns
      .map(
        (c) =>
          `<th style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;text-align:left;font-size:12px">${escape(
            c.label,
          )}</th>`,
      )
      .join('');

    const body = report.rows
      .map(
        (row) =>
          `<tr>${report.columns
            .map(
              (c) =>
                `<td style="padding:8px;border:1px solid #e2e8f0;font-size:13px">${escape(
                  row[c.key],
                )}</td>`,
            )
            .join('')}</tr>`,
      )
      .join('');

    return `
      <div style="font-family:system-ui,sans-serif;color:#0f172a">
        <h2 style="margin:0 0 4px">${escape(report.name)}</h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:13px">
          Generated ${new Date(report.generatedAt).toLocaleString()}
        </p>
        ${stats ? `<table style="border-collapse:collapse;margin-bottom:16px"><tr>${stats}</tr></table>` : ''}
        <table style="border-collapse:collapse;width:100%">
          <thead><tr>${header}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  /** Fires schedules whose send time has arrived. */
  @Cron(CronExpression.EVERY_MINUTE)
  async runSchedules(): Promise<void> {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes(),
    ).padStart(2, '0')}`;

    const due = await this.prisma.reportSchedule.findMany({
      where: { isActive: true, sendAt: hhmm },
    });

    for (const schedule of due) {
      if (!this.isDue(schedule.frequency, schedule.lastSentAt, now)) continue;
      try {
        await this.deliver(schedule);
      } catch (err) {
        this.logger.error(
          `Report schedule "${schedule.name}" failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  private isDue(
    frequency: string,
    lastSentAt: Date | null,
    now: Date,
  ): boolean {
    if (!lastSentAt) return true;
    const elapsedDays =
      (now.getTime() - lastSentAt.getTime()) / (24 * 60 * 60 * 1000);
    if (frequency === 'daily') return elapsedDays >= 0.9;
    if (frequency === 'weekly') return elapsedDays >= 6.9;
    return elapsedDays >= 27.9;
  }
}
