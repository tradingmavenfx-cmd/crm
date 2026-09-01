import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IvrAction,
  PlaceCallInput,
  PlaceCallResult,
  RenderedIvr,
  VoiceProvider,
} from './voice-provider.interface';

interface TwilioCallResponse {
  sid?: string;
  message?: string; // error message
}

/** Escapes text interpolated into TwiML. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Real cloud-telephony provider (Twilio Programmable Voice).
 * Uses the global fetch available in Node 18+/22 - no extra dependency.
 */
@Injectable()
export class TwilioVoiceProvider implements VoiceProvider {
  private readonly logger = new Logger('VoiceTwilio');

  constructor(private readonly config: ConfigService) {}

  /**
   * Click-to-call: Twilio dials the agent first, then bridges the customer in
   * once the agent picks up.
   */
  async placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
    const sid = this.config.get<string>('voice.accountSid');
    const token = this.config.get<string>('voice.authToken');
    const from = this.config.get<string>('voice.from');
    const statusCallback = this.config.get<string>('voice.statusCallbackUrl');

    const bridge = this.renderIvr({
      say: 'Connecting your call.',
      dial: { number: input.to },
    }).body;

    const body = new URLSearchParams({
      To: input.agentNumber,
      From: from!,
      Twiml: bridge,
    });
    if (statusCallback) {
      body.set('StatusCallback', statusCallback);
      body.set('StatusCallbackEvent', 'completed');
    }

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );

    const data = (await res.json()) as TwilioCallResponse;
    if (!res.ok || !data.sid) {
      this.logger.error(`Call failed: ${data.message ?? res.status}`);
      throw new InternalServerErrorException('Click-to-call failed');
    }
    this.logger.log(`Placed call to ${input.to} (${data.sid})`);
    return { externalId: data.sid };
  }

  renderIvr(action: IvrAction): RenderedIvr {
    const parts: string[] = [];
    const say = action.say ? `<Say>${xmlEscape(action.say)}</Say>` : '';

    if (action.gather) {
      const { numDigits, actionUrl, timeoutSec } = action.gather;
      parts.push(
        `<Gather numDigits="${numDigits}" action="${xmlEscape(actionUrl)}" method="POST"` +
          `${timeoutSec ? ` timeout="${timeoutSec}"` : ''}>${say}</Gather>`,
      );
    } else if (say) {
      parts.push(say);
    }

    if (action.dial) {
      const timeout = action.dial.timeoutSec
        ? ` timeout="${action.dial.timeoutSec}"`
        : '';
      parts.push(`<Dial${timeout}>${xmlEscape(action.dial.number)}</Dial>`);
    }

    if (action.record) {
      parts.push(
        `<Record maxLength="${action.record.maxLengthSec}" ` +
          `action="${xmlEscape(action.record.actionUrl)}" method="POST" />`,
      );
    }

    if (action.hangup) parts.push('<Hangup/>');

    return {
      contentType: 'text/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join('')}</Response>`,
    };
  }
}
