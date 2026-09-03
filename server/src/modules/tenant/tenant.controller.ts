import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { TenantSettingsService } from './tenant-settings.service';
import { PlatformService } from './platform.service';
import { UpdateTenantSettingsDto } from './dto/tenant.dto';

@ApiTags('tenant')
@Controller()
export class TenantController {
  constructor(
    private readonly settings: TenantSettingsService,
    private readonly platform: PlatformService,
  ) {}

  // ── This workspace ───────────────────────────

  @Get('settings')
  get(@CurrentUser('tenantId') tenantId: string) {
    return this.settings.get(tenantId);
  }

  @Put('settings')
  @Roles(Role.TENANT_ADMIN)
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateTenantSettingsDto,
  ) {
    return this.settings.update(tenantId, dto);
  }

  @Get('invoices/:id/upi')
  upi(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.settings.upiLinkFor(tenantId, id);
  }

  // ── What a page needs before anybody signs in ──

  @Public()
  @Get('branding')
  branding(@Query('slug') slug?: string, @Query('domain') domain?: string) {
    return this.settings.publicBranding({ slug, domain });
  }

  // ── Running the platform ─────────────────────

  @Get('platform/tenants')
  @Roles(Role.SUPER_ADMIN)
  tenants() {
    return this.platform.tenants();
  }

  @Post('platform/tenants/:id/active')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  setActive(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.platform.setActive(id, isActive);
  }
}
