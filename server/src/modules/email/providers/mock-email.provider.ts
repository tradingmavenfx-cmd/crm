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
    // The body is logged too, so a link that would have been emailed — a
    // portal sign-in link, say — can be opened while developing. This provider
    // is only ever used when no mail server is configured.
    const body = input.text ?? input.html;
    if (body) {
      this.logger.debug('[mock] body:');
      this.logger.debug(body);
    }
    return { externalId: `mock-email-${randomUUID()}` };
  }
}
