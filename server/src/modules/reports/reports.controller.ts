import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { DashboardsService } from './dashboards.service';
import {
  CreateDashboardDto,
  CreateScheduleDto,
  CreateWidgetDto,
  ReorderWidgetsDto,
  RunReportDto,
  UpdateDashboardDto,
  UpdateScheduleDto,
  UpdateWidgetDto,
} from './dto/reports.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly dashboards: DashboardsService,
  ) {}

  // ── Reports ──────────────────────────────────

  @Get('reports')
  list() {
    return this.reports.listReports();
  }

  @Get('reports/:key')
  run(
    @CurrentUser('tenantId') tenantId: string,
    @Param('key') key: string,
    @Query() query: RunReportDto,
  ) {
    return this.reports.run(tenantId, key, query);
  }

  /** Same report, as a CSV download. */
  @Get('reports/:key/export.csv')
  async export(
    @CurrentUser('tenantId') tenantId: string,
    @Param('key') key: string,
    @Query() query: RunReportDto,
    @Res() res: Response,
  ) {
    const report = await this.reports.run(tenantId, key, query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${key.replace('.', '-')}.csv"`,
    });
    res.send(this.reports.toCsv(report));
  }

  // ── Dashboards ───────────────────────────────

  @Get('dashboards')
  listDashboards(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.dashboards.listDashboards(tenantId, role);
  }

  @Get('dashboards/:id')
  getDashboard(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: Role,
    @Param('id') id: string,
  ) {
    return this.dashboards.getDashboard(tenantId, id, role);
  }

  /** The dashboard with every widget's report already computed. */
  @Get('dashboards/:id/render')
  render(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: Role,
    @Param('id') id: string,
  ) {
    return this.dashboards.renderDashboard(tenantId, id, role);
  }

  @Post('dashboards')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createDashboard(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateDashboardDto,
  ) {
    return this.dashboards.createDashboard(tenantId, userId, dto);
  }

  @Patch('dashboards/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateDashboard(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.dashboards.updateDashboard(tenantId, id, dto);
  }

  @Delete('dashboards/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeDashboard(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.dashboards.removeDashboard(tenantId, id);
  }

  // ── Widgets ──────────────────────────────────

  @Post('dashboards/:id/widgets')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  addWidget(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateWidgetDto,
  ) {
    return this.dashboards.addWidget(tenantId, id, dto);
  }

  @Patch('dashboards/:id/widgets/reorder')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  reorder(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: ReorderWidgetsDto,
  ) {
    return this.dashboards.reorderWidgets(tenantId, id, dto.widgetIds);
  }

  @Patch('widgets/:widgetId')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateWidget(
    @CurrentUser('tenantId') tenantId: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: UpdateWidgetDto,
  ) {
    return this.dashboards.updateWidget(tenantId, widgetId, dto);
  }

  @Delete('widgets/:widgetId')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeWidget(
    @CurrentUser('tenantId') tenantId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.removeWidget(tenantId, widgetId);
  }

  // ── Scheduled report emails ──────────────────

  @Get('report-schedules')
  listSchedules(@CurrentUser('tenantId') tenantId: string) {
    return this.dashboards.listSchedules(tenantId);
  }

  @Post('report-schedules')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createSchedule(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.dashboards.createSchedule(tenantId, dto);
  }

  @Patch('report-schedules/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateSchedule(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.dashboards.updateSchedule(tenantId, id, dto);
  }

  @Delete('report-schedules/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeSchedule(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.dashboards.removeSchedule(tenantId, id);
  }

  /** Send one now, without waiting for its cadence. */
  @Post('report-schedules/:id/send')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  sendSchedule(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.dashboards.sendSchedule(tenantId, id);
  }
}
