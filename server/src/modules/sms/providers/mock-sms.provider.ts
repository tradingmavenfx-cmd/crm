import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from './sms-provider.interface';

/**
 * Used when no SMS credentials are configured. Logs the outbound message and
 * returns a synthetic id so the rest of the flow works in dev/tests.
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsMock');

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    this.logger.log(`[mock] sms -> ${input.to}: ${input.text}`);
    return { externalId: `mock-sms-${randomUUID()}` };
  }
}
