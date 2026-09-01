import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import {
  CreateCampaignDto,
  QueryCampaignsDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryCampaignsDto,
  ) {
    return this.campaigns.listCampaigns(tenantId, query);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.campaigns.getCampaign(tenantId, id);
  }

  @Post()
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaigns.createCampaign(tenantId, userId, dto);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.updateCampaign(tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.campaigns.removeCampaign(tenantId, id);
  }

  /** Who this campaign would reach, before committing to send. */
  @Get(':id/preview')
  preview(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.campaigns.preview(tenantId, id);
  }

  @Post(':id/send')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  send(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.campaigns.send(tenantId, id);
  }

  @Post(':id/cancel')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  cancel(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.campaigns.cancelCampaign(tenantId, id);
  }

  @Get(':id/stats')
  stats(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.campaigns.stats(tenantId, id);
  }

  @Get(':id/recipients')
  recipients(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.campaigns.listRecipients(tenantId, id);
  }
}
