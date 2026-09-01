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
    const note = await this.prisma.message.create({
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

    const mentioned = await this.recordMentions(
      tenantId,
      note.id,
      body,
      authorId,
    );
    return { ...note, mentioned };
  }

  /**
   * Turns "@ada" in a note into Mention rows. Matches on first name, last name
   * or the local part of the email, so agents can write what feels natural.
   */
  private async recordMentions(
    tenantId: string,
    messageId: string,
    body: string,
    authorId: string,
  ): Promise<string[]> {
    const handles = [...body.matchAll(/@([\w.-]+)/g)].map((m) =>
      m[1].toLowerCase(),
    );
    if (!handles.length) return [];

    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const matched = users.filter((u) => {
      // Never notify the author about their own note.
      if (u.id === authorId) return false;
      const aliases = [
        u.firstName.toLowerCase(),
        u.lastName.toLowerCase(),
        `${u.firstName}${u.lastName}`.toLowerCase(),
        u.email.split('@')[0].toLowerCase(),
      ];
      return handles.some((h) => aliases.includes(h));
    });

    for (const user of matched) {
      await this.prisma.mention.upsert({
        where: { messageId_userId: { messageId, userId: user.id } },
        update: {},
        create: { tenantId, messageId, userId: user.id },
      });
    }

    return matched.map((u) => u.id);
  }

  /** Notes where the current user was @mentioned. */
  listMentions(tenantId: string, userId: string, unreadOnly = false) {
    return this.prisma.mention.findMany({
      where: { tenantId, userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        message: {
          select: {
            id: true,
            body: true,
            conversationId: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async markMentionRead(tenantId: string, userId: string, id: string) {
    const mention = await this.prisma.mention.findFirst({
      where: { id, tenantId, userId },
    });
    if (!mention) throw new NotFoundException('Mention not found');
    return this.prisma.mention.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
