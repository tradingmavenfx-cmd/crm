export interface SendSmsInput {
  to: string; // E.164 phone number
  text: string;
}

export interface SendSmsResult {
  externalId: string; // provider message id (e.g. Twilio MessageSid)
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  send(input: SendSmsInput): Promise<SendSmsResult>;
}
