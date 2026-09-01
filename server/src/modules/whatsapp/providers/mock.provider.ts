import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  SendInteractiveInput,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  WhatsAppProvider,
} from './whatsapp-provider.interface';

/**
 * Used when no WhatsApp credentials are configured. Logs the outbound message
 * and returns a synthetic message id so the rest of the flow works in dev/tests.
 */
@Injectable()
export class MockWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger('WhatsAppMock');

  async sendText(input: SendTextInput): Promise<SendResult> {
    this.logger.log(`[mock] text -> ${input.to}: ${input.text}`);
    return { externalId: `mock-${randomUUID()}` };
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    this.logger.log(
      `[mock] template "${input.templateName}" -> ${input.to} (${input.parameters?.join(', ') ?? ''})`,
    );
    return { externalId: `mock-${randomUUID()}` };
  }

  async sendInteractive(input: SendInteractiveInput): Promise<SendResult> {
    this.logger.log(
      `[mock] ${input.type} -> ${input.to}: "${input.body}" [${input.options
        .map((o) => o.title)
        .join(' | ')}]`,
    );
    return { externalId: `mock-${randomUUID()}` };
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    this.logger.log(`[mock] ${input.kind} -> ${input.to}: ${input.url}`);
    return { externalId: `mock-${randomUUID()}` };
  }
}
