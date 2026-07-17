import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  // ── Pipeline stages ──────────────────────────
  @Post('stages')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createStage(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateStageDto,
  ) {
    return this.dealsService.createStage(tenantId, dto);
  }

  @Get('stages')
  listStages(@CurrentUser('tenantId') tenantId: string) {
    return this.dealsService.listStages(tenantId);
  }

  // ── Deals ────────────────────────────────────
  @Post()
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateDealDto,
  ) {
    return this.dealsService.create(tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.dealsService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.dealsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.dealsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.dealsService.remove(tenantId, id);
  }
}
