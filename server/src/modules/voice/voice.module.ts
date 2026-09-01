import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceService } from './voice.service';
import { VoiceController } from './voice.controller';
import { SmsModule } from '../sms/sms.module';
import { VOICE_PROVIDER } from './providers/voice-provider.interface';
import { MockVoiceProvider } from './providers/mock-voice.provider';
import { TwilioVoiceProvider } from './providers/twilio-voice.provider';

@Module({
  // SMS is used by missed-call automation (auto callback text).
  imports: [SmsModule],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    MockVoiceProvider,
    TwilioVoiceProvider,
    {
      // Use the real telephony platform only when credentials are configured;
      // otherwise fall back to the mock so the IVR can be driven without a line.
      provide: VOICE_PROVIDER,
      inject: [ConfigService, TwilioVoiceProvider, MockVoiceProvider],
      useFactory: (
        config: ConfigService,
        twilio: TwilioVoiceProvider,
        mock: MockVoiceProvider,
      ) => (config.get<boolean>('voice.enabled') ? twilio : mock),
    },
  ],
  exports: [VoiceService],
})
export class VoiceModule {}
