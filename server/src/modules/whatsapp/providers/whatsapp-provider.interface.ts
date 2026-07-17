export interface SendTextInput {
  to: string; // E.164 phone number
  text: string;
}

export interface SendTemplateInput {
  to: string;
  templateName: string;
  languageCode: string;
  // Body parameter values, in order
  parameters?: string[];
}

export interface SendResult {
  externalId: string; // provider message id (wamid)
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

export interface WhatsAppProvider {
  sendText(input: SendTextInput): Promise<SendResult>;
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
}
