import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SendInteractiveInput,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  WhatsAppProvider,
} from './whatsapp-provider.interface';

interface GraphResponse {
  messages?: { id: string }[];
  error?: { message: string };
}

/**
 * Real WhatsApp Cloud API (Meta Graph API) implementation.
 * Uses the global fetch available in Node 18+/22.
 */
@Injectable()
export class MetaCloudProvider implements WhatsAppProvider {
  private readonly logger = new Logger('WhatsAppMeta');

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    const version = this.config.get<string>('whatsapp.apiVersion');
    const phoneId = this.config.get<string>('whatsapp.phoneNumberId');
    return `https://graph.facebook.com/${version}/${phoneId}/messages`;
  }

  private async post(payload: Record<string, unknown>): Promise<SendResult> {
    const token = this.config.get<string>('whatsapp.accessToken');
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as GraphResponse;
    if (!res.ok || !data.messages?.length) {
      this.logger.error(
        `WhatsApp send failed: ${data.error?.message ?? res.status}`,
      );
      throw new InternalServerErrorException('WhatsApp send failed');
    }
    return { externalId: data.messages[0].id };
  }

  sendText(input: SendTextInput): Promise<SendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'text',
      text: { body: input.text },
    });
  }

  /**
   * Quick-reply buttons (max 3) or a single-section list (max 10 rows), per the
   * Cloud API interactive message schema.
   */
  sendInteractive(input: SendInteractiveInput): Promise<SendResult> {
    const interactive =
      input.type === 'buttons'
        ? {
            type: 'button',
            body: { text: input.body },
            action: {
              buttons: input.options.slice(0, 3).map((o) => ({
                type: 'reply',
                reply: { id: o.id, title: o.title },
              })),
            },
          }
        : {
            type: 'list',
            body: { text: input.body },
            action: {
              button: input.listButtonText ?? 'Choose',
              sections: [
                {
                  title: input.header ?? 'Options',
                  rows: input.options.slice(0, 10).map((o) => ({
                    id: o.id,
                    title: o.title,
                    description: o.description,
                  })),
                },
              ],
            },
          };

    return this.post({
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'interactive',
      interactive: {
        ...interactive,
        ...(input.header && input.type === 'buttons'
          ? { header: { type: 'text', text: input.header } }
          : {}),
        ...(input.footer ? { footer: { text: input.footer } } : {}),
      },
    });
  }

  sendMedia(input: SendMediaInput): Promise<SendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to: input.to,
      type: input.kind,
      [input.kind]: {
        link: input.url,
        ...(input.caption && input.kind !== 'audio'
          ? { caption: input.caption }
          : {}),
        ...(input.filename && input.kind === 'document'
          ? { filename: input.filename }
          : {}),
      },
    });
  }

  sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        components: input.parameters?.length
          ? [
              {
                type: 'body',
                parameters: input.parameters.map((text) => ({
                  type: 'text',
                  text,
                })),
              },
            ]
          : undefined,
      },
    });
  }
}
