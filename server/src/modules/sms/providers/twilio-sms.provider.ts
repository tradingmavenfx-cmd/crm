import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from './sms-provider.interface';

interface TwilioMessageResponse {
  sid?: string;
  message?: string; // error message
}

/**
 * Real SMS provider (Twilio Programmable Messaging REST API).
 * Uses the global fetch available in Node 18+/22 — no extra dependency.
 */
@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsTwilio');

  constructor(private readonly config: ConfigService) {}

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const sid = this.config.get<string>('sms.accountSid');
    const token = this.config.get<string>('sms.authToken');
    const from = this.config.get<string>('sms.from');

    const body = new URLSearchParams({
      To: input.to,
      From: from!,
      Body: input.text,
    });
    // Indian senders must attach the DLT entity/template ids registered with TRAI.
    const dltEntityId = this.config.get<string>('sms.dltEntityId');
    if (dltEntityId) body.set('MessagingServiceSid', dltEntityId);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );

    const data = (await res.json()) as TwilioMessageResponse;
    if (!res.ok || !data.sid) {
      this.logger.error(`SMS send failed: ${data.message ?? res.status}`);
      throw new InternalServerErrorException('SMS send failed');
    }
    this.logger.log(`Sent SMS to ${input.to} (${data.sid})`);
    return { externalId: data.sid };
  }
}
