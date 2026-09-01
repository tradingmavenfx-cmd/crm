import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Channel, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from './providers/whatsapp-provider.interface';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger('WhatsappService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  /** Finds or creates a WhatsApp conversation for a given external phone. */
  private async getOrCreateConversation(tenantId: string, externalId: string) {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalId: {
          tenantId,
          channel: Channel.WHATSAPP,
          externalId,
        },
      },
    });
    if (existing) return existing;

    // Link to a contact if one matches this phone number.
    const contact = await this.prisma.contact.findFirst({
      where: { tenantId, phone: externalId },
    });

    return this.prisma.conversation.create({
      data: {
        tenantId,
        channel: Channel.WHATSAPP,
        externalId,
        contactId: contact?.id,
      },
    });
  }

  async send(tenantId: string, dto: SendMessageDto) {
    const conversation = await this.getOrCreateConversation(tenantId, dto.to);

    const isTemplate = Boolean(dto.templateName);
    const result = isTemplate
      ? await this.provider.sendTemplate({
          to: dto.to,
          templateName: dto.templateName!,
          languageCode: dto.languageCode ?? 'en_US',
          parameters: dto.parameters,
        })
      : await this.provider.sendText({ to: dto.to, text: dto.text! });

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channel: Channel.WHATSAPP,
        direction: MessageDirection.OUTBOUND,
        type: isTemplate ? 'template' : 'text',
        body: isTemplate ? `[template:${dto.templateName}]` : dto.text,
        externalId: result.externalId,
        status: MessageStatus.SENT,
      },
    });

    // SLA: record the first agent response time (first outbound after inbound).
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        firstResponseAt: conversation.firstResponseAt ?? new Date(),
      },
    });

    return message;
  }

  async updateConversation(
    tenantId: string,
    id: string,
    data: { assignedToId?: string; status?: string },
  ) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    return this.prisma.conversation.update({
      where: { id },
      data: {
        assignedToId:
          data.assignedToId === '' ? null : (data.assignedToId ?? undefined),
        status: data.status ?? undefined,
      },
      include: {
        contact: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async addNote(
    tenantId: string,
    conversationId: string,
    authorId: string,
    body: string,
  ) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    return this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        channel: Channel.WHATSAPP,
        direction: MessageDirection.OUTBOUND,
        type: 'note',
        body,
        isInternal: true,
        authorId,
        status: MessageStatus.SENT,
      },
    });
  }

  // ── Canned responses (macros) ────────────────
  listCanned(tenantId: string) {
    return this.prisma.cannedResponse.findMany({
      where: { tenantId },
      orderBy: { title: 'asc' },
    });
  }

  createCanned(tenantId: string, data: { title: string; body: string }) {
    return this.prisma.cannedResponse.create({ data: { tenantId, ...data } });
  }

  async updateCanned(
    tenantId: string,
    id: string,
    data: { title?: string; body?: string },
  ) {
    const existing = await this.prisma.cannedResponse.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Canned response not found');
    return this.prisma.cannedResponse.update({ where: { id }, data });
  }

  async removeCanned(tenantId: string, id: string) {
    const existing = await this.prisma.cannedResponse.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Canned response not found');
    await this.prisma.cannedResponse.delete({ where: { id } });
    return { success: true };
  }

  listConversations(tenantId: string) {
    return this.prisma.conversation.findMany({
      where: { tenantId, channel: Channel.WHATSAPP },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  listMessages(tenantId: string, conversationId: string) {
    return this.prisma.message.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Processes an inbound WhatsApp webhook payload: records incoming messages
   * and updates delivery statuses for outbound messages.
   * The tenant is resolved from the business phone_number_id metadata.
   */
  async handleWebhook(payload: WebhookPayload): Promise<void> {
    const entries = payload.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const tenantId = await this.resolveTenant(phoneNumberId);
        if (!tenantId) {
          this.logger.warn(`No tenant for phone_number_id ${phoneNumberId}`);
          continue;
        }

        // Inbound messages
        for (const msg of value.messages ?? []) {
          await this.recordInbound(tenantId, msg);
        }

        // Delivery/read status callbacks
        for (const status of value.statuses ?? []) {
          await this.updateStatus(status);
        }
      }
    }
  }

  private async recordInbound(tenantId: string, msg: InboundMessage) {
    const conversation = await this.getOrCreateConversation(tenantId, msg.from);
    await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channel: Channel.WHATSAPP,
        direction: MessageDirection.INBOUND,
        type: msg.type ?? 'text',
        body: msg.text?.body ?? null,
        externalId: msg.id,
        status: MessageStatus.RECEIVED,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), status: 'open' },
    });
  }

  private async updateStatus(status: StatusUpdate) {
    const map: Record<string, MessageStatus> = {
      sent: MessageStatus.SENT,
      delivered: MessageStatus.DELIVERED,
      read: MessageStatus.READ,
      failed: MessageStatus.FAILED,
    };
    const mapped = map[status.status];
    if (!mapped) return;
    await this.prisma.message.updateMany({
      where: { externalId: status.id },
      data: { status: mapped },
    });
  }

  /**
   * Maps a WhatsApp business phone_number_id to a tenant. For the MVP we use a
   * single-tenant fallback (first tenant); production would store the mapping
   * on the tenant record / a channel-config table.
   */
  private async resolveTenant(_phoneNumberId: string): Promise<string | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return tenant?.id ?? null;
  }
}

// ── Webhook payload shapes (subset of the Meta schema we consume) ──
export interface WebhookPayload {
  entry?: {
    changes?: {
      value: {
        metadata?: { phone_number_id?: string };
        messages?: InboundMessage[];
        statuses?: StatusUpdate[];
      };
    }[];
  }[];
}

interface InboundMessage {
  id: string;
  from: string;
  type?: string;
  text?: { body?: string };
}

interface StatusUpdate {
  id: string;
  status: string;
}
