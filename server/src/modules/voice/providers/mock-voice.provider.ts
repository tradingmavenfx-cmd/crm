import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  IvrAction,
  PlaceCallInput,
  PlaceCallResult,
  RenderedIvr,
  VoiceProvider,
} from './voice-provider.interface';

/**
 * Used when no telephony credentials are configured. Logs the call leg and
 * renders IVR steps as plain JSON so the flow can be driven from curl/tests
 * without a real phone line.
 */
@Injectable()
export class MockVoiceProvider implements VoiceProvider {
  private readonly logger = new Logger('VoiceMock');

  async placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
    this.logger.log(`[mock] call ${input.agentNumber} -> ${input.to}`);
    return { externalId: `mock-call-${randomUUID()}` };
  }

  renderIvr(action: IvrAction): RenderedIvr {
    return {
      contentType: 'application/json',
      body: JSON.stringify(action),
    };
  }
}
