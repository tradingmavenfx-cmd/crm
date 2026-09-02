import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { SignalsService } from './signals.service';
import { AiController } from './ai.controller';
import { ReportsModule } from '../reports/reports.module';
import { AI_PROVIDER } from './providers/ai-provider.interface';
import { MockAiProvider } from './providers/mock-ai.provider';
import { OpenAiProvider } from './providers/openai.provider';

@Module({
  // Natural-language questions are answered out of the report catalogue.
  imports: [ReportsModule],
  controllers: [AiController],
  providers: [
    AiService,
    SignalsService,
    MockAiProvider,
    OpenAiProvider,
    {
      // Use the real model only when a key is configured; otherwise the mock,
      // which writes the same explanations from the same computed numbers.
      provide: AI_PROVIDER,
      inject: [ConfigService, OpenAiProvider, MockAiProvider],
      useFactory: (
        config: ConfigService,
        openai: OpenAiProvider,
        mock: MockAiProvider,
      ) => (config.get<boolean>('ai.enabled') ? openai : mock),
    },
  ],
  exports: [AiService, SignalsService],
})
export class AiModule {}
