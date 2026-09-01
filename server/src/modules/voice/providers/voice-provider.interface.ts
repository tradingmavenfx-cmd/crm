export interface PlaceCallInput {
  /** Customer number to reach (E.164) */
  to: string;
  /** Agent leg — the call connects this number to `to` */
  agentNumber: string;
}

export interface PlaceCallResult {
  externalId: string; // provider call id (e.g. Twilio CallSid)
}

/**
 * Provider-neutral description of what the caller should hear next. The service
 * builds these from the IVR flow; each provider renders it into its own dialect
 * (TwiML for Twilio, plain JSON for the mock).
 */
export interface IvrAction {
  /** Text to read out before anything else happens */
  say?: string;
  /** Collect DTMF keypresses */
  gather?: {
    numDigits: number;
    actionUrl: string;
    timeoutSec?: number;
  };
  /** Connect the caller to a number */
  dial?: { number: string; timeoutSec?: number };
  /** Record a voicemail */
  record?: { maxLengthSec: number; actionUrl: string };
  /** End the call */
  hangup?: boolean;
}

export interface RenderedIvr {
  contentType: string;
  body: string;
}

export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');

export interface VoiceProvider {
  placeCall(input: PlaceCallInput): Promise<PlaceCallResult>;
  /** Renders an IvrAction into the response the telephony platform expects. */
  renderIvr(action: IvrAction): RenderedIvr;
}
