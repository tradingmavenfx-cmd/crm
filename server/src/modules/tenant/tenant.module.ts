import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantSettingsService } from './tenant-settings.service';
import { PlatformService } from './platform.service';

@Module({
  controllers: [TenantController],
  providers: [TenantSettingsService, PlatformService],
  exports: [TenantSettingsService],
})
export class TenantModule {}
