import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import { MockSmsProvider } from './providers/mock-sms.provider';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';

@Module({
  controllers: [SmsController],
  providers: [
    SmsService,
    MockSmsProvider,
    TwilioSmsProvider,
    {
      // Use the real gateway only when credentials are configured; otherwise
      // fall back to the mock so dev/tests work without an SMS account.
      provide: SMS_PROVIDER,
      inject: [ConfigService, TwilioSmsProvider, MockSmsProvider],
      useFactory: (
        config: ConfigService,
        twilio: TwilioSmsProvider,
        mock: MockSmsProvider,
      ) => (config.get<boolean>('sms.enabled') ? twilio : mock),
    },
  ],
  exports: [SmsService],
})
export class SmsModule {}
