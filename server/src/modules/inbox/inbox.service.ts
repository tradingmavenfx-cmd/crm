import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  MessageDirection,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { QueryInboxDto } from './dto/query-inbox.dto';
import { ReplyDto } from './dto/reply.dto';

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
  ) {}

  /** All conversations across every channel, newest activity first. */
  listConversations(tenantId: string, query: QueryInboxDto) {
    const where: Prisma.ConversationWhereInput = { tenantId };
    if (query.channel) where.channel = query.channel;
    if (query.status) where.status = query.status;
    if (query.assignedToId) where.assignedToId = query.assignedToId;

    return this.prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { messages: true } },
      },
    });
  }

  async getConversation(tenantId: string, id: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return conv;
  }

  listMessages(tenantId: string, conversationId: string) {
    return this.prisma.message.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Sends a reply on whichever channel the conversation belongs to. */
  async reply(tenantId: string, conversationId: string, dto: ReplyDto) {
    const conv = await this.getConversation(tenantId, conversationId);

    if (conv.channel === Channel.WHATSAPP) {
      return this.whatsapp.send(tenantId, {
        to: conv.externalId,
        text: dto.text,
      });
    }

    if (conv.channel === Channel.EMAIL) {
      // Reuse the subject from the latest message in the thread when possible.
      const last = await this.prisma.message.findFirst({
        where: { tenantId, conversationId, subject: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      const subject =
        dto.subject ??
        (last?.subject
          ? `Re: ${last.subject.replace(/^Re:\s*/i, '')}`
          : 'Reply');
      return this.email.send(tenantId, {
        to: conv.externalId,
        subject,
        text: dto.text,
      });
    }

    if (conv.channel === Channel.SMS) {
      return this.sms.send(tenantId, { to: conv.externalId, text: dto.text });
    }

    if (conv.channel === Channel.VOICE) {
      // A call thread has no text leg - the agent calls back or texts instead.
      throw new BadRequestException(
        'Voice conversations cannot be replied to by text - use click-to-call, or reply on the SMS thread',
      );
    }

    throw new BadRequestException(
      `Replies are not supported on the ${conv.channel} channel yet`,
    );
  }

  async updateConversation(
    tenantId: string,
    id: string,
    data: { assignedToId?: string; status?: string },
  ) {
    await this.getConversation(tenantId, id);
    return this.prisma.conversation.update({
      where: { id },
      data: {
        assignedToId:
          data.assignedToId === '' ? null : (data.assignedToId ?? undefined),
        status: data.status ?? undefined,
      },
      include: {
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
    const conv = await this.getConversation(tenantId, conversationId);
    return this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        channel: conv.channel,
        direction: MessageDirection.OUTBOUND,
        type: 'note',
        body,
        isInternal: true,
        authorId,
        status: MessageStatus.SENT,
      },
    });
  }
}
