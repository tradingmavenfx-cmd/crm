import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { QuotaPeriod, Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TerritoriesService } from './territories.service';
import { ForecastService } from './forecast.service';
import { GamificationService } from './gamification.service';
import {
  AssignTerritoriesDto,
  CategoriseDealDto,
  CreateBadgeDto,
  CreateContestDto,
  CreateTerritoryDto,
  ForecastQueryDto,
  LeaderboardDto,
  PerformanceQueryDto,
  TerritoryMemberDto,
  UpdateTerritoryDto,
  UpsertQuotaDto,
  WhatIfDto,
} from './dto/sales.dto';

@ApiTags('sales')
@Controller()
export class SalesController {
  constructor(
    private readonly territories: TerritoriesService,
    private readonly forecast: ForecastService,
    private readonly gamification: GamificationService,
  ) {}

  // ── Territories ──────────────────────────────

  @Get('territories')
  listTerritories(@CurrentUser('tenantId') tenantId: string) {
    return this.territories.list(tenantId);
  }

  @Get('territories/performance')
  performance(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: PerformanceQueryDto,
  ) {
    return this.territories.performance(
      tenantId,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Get('territories/:id')
  getTerritory(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.territories.get(tenantId, id);
  }

  @Post('territories')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createTerritory(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateTerritoryDto,
  ) {
    return this.territories.create(tenantId, dto);
  }

  @Patch('territories/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateTerritory(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTerritoryDto,
  ) {
    return this.territories.update(tenantId, id, dto);
  }

  @Delete('territories/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeTerritory(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.territories.remove(tenantId, id);
  }

  @Post('territories/:id/members')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  addMember(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: TerritoryMemberDto,
  ) {
    return this.territories.addMember(tenantId, id, dto.userId);
  }

  @Delete('territories/:id/members/:userId')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeMember(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.territories.removeMember(tenantId, id, userId);
  }

  @Post('territories/assign')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  @HttpCode(200)
  assign(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: AssignTerritoriesDto,
  ) {
    return this.territories.assign(tenantId, dto?.reassignAll ?? false);
  }

  // ── Quotas & forecast ────────────────────────

  @Get('quotas')
  listQuotas(
    @CurrentUser('tenantId') tenantId: string,
    @Query('period') period?: QuotaPeriod,
  ) {
    return this.forecast.listQuotas(tenantId, period);
  }

  @Post('quotas')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  upsertQuota(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpsertQuotaDto,
  ) {
    return this.forecast.upsertQuota(tenantId, dto);
  }

  @Delete('quotas/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeQuota(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.forecast.removeQuota(tenantId, id);
  }

  @Get('forecast')
  getForecast(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: ForecastQueryDto,
  ) {
    return this.forecast.forecast(tenantId, query);
  }

  @Get('forecast/what-if')
  whatIf(@CurrentUser('tenantId') tenantId: string, @Query() query: WhatIfDto) {
    return this.forecast.whatIf(tenantId, query);
  }

  @Get('forecast/accuracy')
  accuracy(
    @CurrentUser('tenantId') tenantId: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.forecast.accuracy(tenantId, ownerId);
  }

  @Post('forecast/snapshot')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  @HttpCode(200)
  snapshot(
    @CurrentUser('tenantId') tenantId: string,
    @Body('period') period?: QuotaPeriod,
  ) {
    return this.forecast.takeSnapshot(tenantId, period ?? QuotaPeriod.QUARTER);
  }

  @Patch('deals/:id/forecast-category')
  categorise(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CategoriseDealDto,
  ) {
    return this.forecast.categorise(tenantId, id, dto.category);
  }

  // ── Gamification ─────────────────────────────

  @Get('leaderboard')
  leaderboard(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: LeaderboardDto,
  ) {
    return this.gamification.leaderboard(tenantId, query);
  }

  @Get('contests')
  listContests(@CurrentUser('tenantId') tenantId: string) {
    return this.gamification.listContests(tenantId);
  }

  @Post('contests')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createContest(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateContestDto,
  ) {
    return this.gamification.createContest(tenantId, dto);
  }

  @Get('contests/:id/standings')
  contestStandings(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.gamification.contestStandings(tenantId, id);
  }

  @Delete('contests/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeContest(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.gamification.removeContest(tenantId, id);
  }

  @Get('badges')
  listBadges(@CurrentUser('tenantId') tenantId: string) {
    return this.gamification.listBadges(tenantId);
  }

  @Post('badges')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createBadge(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateBadgeDto,
  ) {
    return this.gamification.createBadge(tenantId, dto);
  }

  @Delete('badges/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeBadge(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.gamification.removeBadge(tenantId, id);
  }

  @Post('badges/award')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  @HttpCode(200)
  award(@CurrentUser('tenantId') tenantId: string) {
    return this.gamification.awardBadges(tenantId);
  }

  @Get('badges/mine')
  myBadges(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.gamification.userBadges(tenantId, userId);
  }
}
