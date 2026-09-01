import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider.interface';
import { MetaCloudProvider } from './providers/meta-cloud.provider';
import { MockWhatsAppProvider } from './providers/mock.provider';
import { RoutingModule } from '../routing/routing.module';

@Module({
  imports: [RoutingModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    MetaCloudProvider,
    MockWhatsAppProvider,
    {
      // Pick the real Meta provider only when credentials are configured;
      // otherwise fall back to the mock so dev/tests work without secrets.
      provide: WHATSAPP_PROVIDER,
      inject: [ConfigService, MetaCloudProvider, MockWhatsAppProvider],
      useFactory: (
        config: ConfigService,
        meta: MetaCloudProvider,
        mock: MockWhatsAppProvider,
      ) => (config.get<boolean>('whatsapp.enabled') ? meta : mock),
    },
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
