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

/** A quick-reply button or a call-to-action row in a list message. */
export interface InteractiveOption {
  /** Value echoed back on the inbound webhook when the user picks this */
  id: string;
  title: string;
  description?: string;
}

export interface SendInteractiveInput {
  to: string;
  /** buttons: up to 3 quick replies; list: up to 10 rows in one section */
  type: 'buttons' | 'list';
  body: string;
  header?: string;
  footer?: string;
  /** Label on the button that opens a list message */
  listButtonText?: string;
  options: InteractiveOption[];
}

export interface SendMediaInput {
  to: string;
  kind: 'image' | 'video' | 'document' | 'audio';
  /** Publicly reachable URL of the media */
  url: string;
  caption?: string;
  /** Shown to the recipient for documents */
  filename?: string;
}

export interface SendResult {
  externalId: string; // provider message id (wamid)
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

export interface WhatsAppProvider {
  sendText(input: SendTextInput): Promise<SendResult>;
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
  sendInteractive(input: SendInteractiveInput): Promise<SendResult>;
  sendMedia(input: SendMediaInput): Promise<SendResult>;
}
