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
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiKeysService } from './api-keys.service';
import { WebhooksService, WEBHOOK_EVENTS } from './webhooks.service';
import {
  CreateApiKeyDto,
  CreateWebhookDto,
  TestWebhookDto,
  UpdateWebhookDto,
} from './dto/developer.dto';

@ApiTags('developer')
@Controller('developer')
export class DeveloperController {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ── API keys ─────────────────────────────────

  @Get('keys')
  @Roles(Role.TENANT_ADMIN)
  listKeys(@CurrentUser('tenantId') tenantId: string) {
    return this.apiKeys.list(tenantId);
  }

  @Post('keys')
  @Roles(Role.TENANT_ADMIN)
  createKey(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeys.create(tenantId, userId, dto);
  }

  @Delete('keys/:id')
  @Roles(Role.TENANT_ADMIN)
  revokeKey(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.apiKeys.revoke(tenantId, id);
  }

  // ── Webhooks ─────────────────────────────────

  /** The catalogue a destination can subscribe to. */
  @Get('events')
  events() {
    return WEBHOOK_EVENTS;
  }

  @Get('webhooks')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  listWebhooks(@CurrentUser('tenantId') tenantId: string) {
    return this.webhooks.list(tenantId);
  }

  @Post('webhooks')
  @Roles(Role.TENANT_ADMIN)
  createWebhook(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooks.create(tenantId, dto);
  }

  @Patch('webhooks/:id')
  @Roles(Role.TENANT_ADMIN)
  updateWebhook(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(tenantId, id, dto);
  }

  @Delete('webhooks/:id')
  @Roles(Role.TENANT_ADMIN)
  removeWebhook(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.webhooks.remove(tenantId, id);
  }

  /** Sends a sample, so a destination can be checked before it matters. */
  @Post('webhooks/:id/test')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(200)
  async testWebhook(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: TestWebhookDto,
  ) {
    await this.webhooks.dispatchTo(tenantId, id, dto?.event ?? 'ping', {
      note: 'This is a test delivery.',
    });
    return { sent: true };
  }

  @Get('deliveries')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  deliveries(
    @CurrentUser('tenantId') tenantId: string,
    @Query('webhookId') webhookId?: string,
  ) {
    return this.webhooks.deliveries(tenantId, webhookId);
  }

  @Post('deliveries/:id/replay')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(200)
  replay(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.webhooks.replay(tenantId, id);
  }
}
