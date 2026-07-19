import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from './email-provider.interface';

/**
 * Used when no SMTP host is configured. Logs the outbound email and returns a
 * synthetic id so the rest of the flow works in dev/tests without a mail server.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger('EmailMock');

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.logger.log(`[mock] email -> ${input.to} | subject: ${input.subject}`);
    return { externalId: `mock-email-${randomUUID()}` };
  }
}
