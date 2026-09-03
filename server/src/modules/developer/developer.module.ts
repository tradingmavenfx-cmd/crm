import { Global, Module } from '@nestjs/common';
import { DeveloperController } from './developer.controller';
import { ApiKeysService } from './api-keys.service';
import { WebhooksService } from './webhooks.service';

/**
 * Global, because the authentication guard has to be able to resolve an API
 * key and the guard is registered on the application root.
 */
@Global()
@Module({
  controllers: [DeveloperController],
  providers: [ApiKeysService, WebhooksService],
  exports: [ApiKeysService, WebhooksService],
})
export class DeveloperModule {}
