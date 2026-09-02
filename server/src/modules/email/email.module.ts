import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { MockEmailProvider } from './providers/mock-email.provider';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { TrackingModule } from '../tracking/tracking.module';
import { RoutingModule } from '../routing/routing.module';

@Module({
  imports: [TrackingModule, RoutingModule],
  controllers: [EmailController],
  providers: [
    EmailService,
    MockEmailProvider,
    SmtpEmailProvider,
    {
      // Use the real SMTP provider only when an SMTP host is configured;
      // otherwise fall back to the mock so dev/tests work without a mail server.
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, SmtpEmailProvider, MockEmailProvider],
      useFactory: (
        config: ConfigService,
        smtp: SmtpEmailProvider,
        mock: MockEmailProvider,
      ) => (config.get<boolean>('email.enabled') ? smtp : mock),
    },
  ],
  // EMAIL_PROVIDER is exported for senders that are not conversations — the
  // portal's sign-in link has no business in an agent's inbox.
  exports: [EmailService, EMAIL_PROVIDER],
})
export class EmailModule {}
