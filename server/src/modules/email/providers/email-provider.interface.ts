export interface SendEmailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface SendEmailResult {
  externalId: string; // provider message id
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
