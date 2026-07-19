import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SendEmailDto } from './dto/send-email.dto';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from './providers/email-provider.interface';

export interface InboundEmailDto {
  from: string;
  subject?: string;
  text?: string;
  html?: string;
}

@Injectable()
export class EmailService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  private async getOrCreateConversation(tenantId: string, email: string) {
    const externalId = email.toLowerCase();
    const existing = await this.prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalId: {
          tenantId,
          channel: Channel.EMAIL,
          externalId,
        },
      },
    });
    if (existing) return existing;

    const contact = await this.prisma.contact.findFirst({
      where: { tenantId, email: externalId },
    });

    return this.prisma.conversation.create({
      data: {
        tenantId,
        channel: Channel.EMAIL,
        externalId,
        contactId: contact?.id,
      },
    });
  }

  async send(tenantId: string, dto: SendEmailDto) {
    let subject = dto.subject ?? '';
    let html = dto.html;
    let text = dto.text;

    if (dto.templateId) {
      const tpl = await this.prisma.emailTemplate.findFirst({
        where: { id: dto.templateId, tenantId },
      });
      if (!tpl) throw new NotFoundException('Email template not found');
      subject = subject || tpl.subject;
      html = html || tpl.body;
    }

    const conversation = await this.getOrCreateConversation(tenantId, dto.to);

    const result = await this.provider.send({
      to: dto.to,
      subject,
      html,
      text,
    });

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channel: Channel.EMAIL,
        direction: MessageDirection.OUTBOUND,
        type: 'email',
        subject,
        body: html ?? text ?? '',
        externalId: result.externalId,
        status: MessageStatus.SENT,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        firstResponseAt: conversation.firstResponseAt ?? new Date(),
      },
    });

    return message;
  }

  /** Records an inbound email (e.g. from an inbound-parse webhook). */
  async receive(tenantId: string, dto: InboundEmailDto) {
    const conversation = await this.getOrCreateConversation(tenantId, dto.from);
    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channel: Channel.EMAIL,
        direction: MessageDirection.INBOUND,
        type: 'email',
        subject: dto.subject,
        body: dto.text ?? dto.html ?? '',
        status: MessageStatus.RECEIVED,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), status: 'open' },
    });
    return message;
  }

  // ── Templates ────────────────────────────────
  listTemplates(tenantId: string) {
    return this.prisma.emailTemplate.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  createTemplate(
    tenantId: string,
    data: { name: string; subject: string; body: string },
  ) {
    return this.prisma.emailTemplate.create({ data: { tenantId, ...data } });
  }

  async updateTemplate(
    tenantId: string,
    id: string,
    data: { name?: string; subject?: string; body?: string },
  ) {
    const existing = await this.prisma.emailTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Email template not found');
    return this.prisma.emailTemplate.update({ where: { id }, data });
  }

  async removeTemplate(tenantId: string, id: string) {
    const existing = await this.prisma.emailTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Email template not found');
    await this.prisma.emailTemplate.delete({ where: { id } });
    return { success: true };
  }
}
