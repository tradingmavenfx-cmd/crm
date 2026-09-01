import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Channel, MessageDirection, MessageStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SendBulkSmsDto, SendSmsDto } from './dto/send-sms.dto';
import { SMS_PROVIDER, SmsProvider } from './providers/sms-provider.interface';

export interface InboundSmsDto {
  from: string;
  text?: string;
  externalId?: string;
}

export interface SmsStatusDto {
  externalId: string;
  status: string;
}

/** TRAI/consumer opt-out keywords recognised on inbound SMS. */
const STOP_KEYWORDS = [
  'stop',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'optout',
];
const START_KEYWORDS = ['start', 'unstop', 'subscribe', 'optin'];

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class SmsService {
  private readonly logger = new Logger('SmsService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
  ) {}

  /** Strips spaces/dashes so the same number always maps to one conversation. */
  private normalize(phone: string): string {
    return phone.replace(/[\s()-]/g, '');
  }

  private async getOrCreateConversation(tenantId: string, phone: string) {
    const externalId = this.normalize(phone);
    const existing = await this.prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalId: {
          tenantId,
          channel: Channel.SMS,
          externalId,
        },
      },
    });
    // Common case: an established thread that already knows its contact.
    if (existing?.contactId) return existing;

    const contact = await this.findContactByPhone(tenantId, externalId);

    if (existing) {
      // The thread may pre-date the contact (first text from an unknown
      // number); adopt the contact once one is known.
      if (contact) {
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { contactId: contact.id },
        });
      }
      return existing;
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        channel: Channel.SMS,
        externalId,
        contactId: contact?.id,
      },
    });
  }

  /**
   * Matches a contact on phone. Contacts are stored in whatever format they
   * were entered ("+91-9876543210"), so compare on the normalized value.
   */
  private async findContactByPhone(tenantId: string, phone: string) {
    const normalized = this.normalize(phone);
    const candidates = await this.prisma.contact.findMany({
      where: { tenantId, phone: { not: null } },
      select: { id: true, phone: true },
    });
    return (
      candidates.find((c) => this.normalize(c.phone!) === normalized) ?? null
    );
  }

  /** Fills {{merge}} fields from the supplied variables. */
  private render(body: string, variables?: Record<string, string>): string {
    if (!variables) return body;
    return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
      variables[key] !== undefined ? variables[key] : match,
    );
  }

  async isOptedOut(tenantId: string, phone: string): Promise<boolean> {
    const found = await this.prisma.smsOptOut.findUnique({
      where: { tenantId_phone: { tenantId, phone: this.normalize(phone) } },
    });
    return Boolean(found);
  }

  private async resolveBody(
    tenantId: string,
    dto: {
      text?: string;
      templateId?: string;
      variables?: Record<string, string>;
    },
  ): Promise<string> {
    if (!dto.templateId) return this.render(dto.text ?? '', dto.variables);

    const tpl = await this.prisma.smsTemplate.findFirst({
      where: { id: dto.templateId, tenantId },
    });
    if (!tpl) throw new NotFoundException('SMS template not found');
    return this.render(dto.text || tpl.body, dto.variables);
  }

  async send(tenantId: string, dto: SendSmsDto) {
    if (await this.isOptedOut(tenantId, dto.to)) {
      throw new ForbiddenException(
        'Recipient has opted out of SMS (DND) - message not sent',
      );
    }

    const text = await this.resolveBody(tenantId, dto);
    const conversation = await this.getOrCreateConversation(tenantId, dto.to);
    const result = await this.provider.send({ to: dto.to, text });

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channel: Channel.SMS,
        direction: MessageDirection.OUTBOUND,
        type: 'text',
        body: text,
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

  /**
   * Bulk/campaign send. Opted-out numbers are skipped rather than failing the
   * whole batch, and each recipient still gets its own threaded conversation.
   */
  async sendBulk(tenantId: string, dto: SendBulkSmsDto) {
    const results: {
      to: string;
      status: 'sent' | 'skipped' | 'failed';
      messageId?: string;
      reason?: string;
    }[] = [];

    for (const to of dto.to) {
      try {
        if (await this.isOptedOut(tenantId, to)) {
          results.push({ to, status: 'skipped', reason: 'opted_out' });
          continue;
        }
        const message = await this.send(tenantId, {
          to,
          text: dto.text,
          templateId: dto.templateId,
          variables: dto.variables,
        });
        results.push({ to, status: 'sent', messageId: message.id });
      } catch (err) {
        results.push({
          to,
          status: 'failed',
          reason: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }

    return {
      total: dto.to.length,
      sent: results.filter((r) => r.status === 'sent').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  /** Records an inbound SMS and honours STOP/START opt-out keywords. */
  async receive(tenantId: string, dto: InboundSmsDto) {
    const phone = this.normalize(dto.from);
    const keyword = (dto.text ?? '').trim().toLowerCase();

    if (STOP_KEYWORDS.includes(keyword)) {
      await this.addOptOut(tenantId, phone, 'stop_keyword');
      this.logger.log(`${phone} opted out of SMS`);
    } else if (START_KEYWORDS.includes(keyword)) {
      await this.removeOptOutByPhone(tenantId, phone);
      this.logger.log(`${phone} opted back in to SMS`);
    }

    const conversation = await this.getOrCreateConversation(tenantId, phone);
    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channel: Channel.SMS,
        direction: MessageDirection.INBOUND,
        type: 'text',
        body: dto.text ?? '',
        externalId: dto.externalId,
        status: MessageStatus.RECEIVED,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), status: 'open' },
    });

    return message;
  }

  /** Delivery-status callback for a previously sent message. */
  async updateStatus(dto: SmsStatusDto) {
    const map: Record<string, MessageStatus> = {
      queued: MessageStatus.QUEUED,
      sent: MessageStatus.SENT,
      delivered: MessageStatus.DELIVERED,
      read: MessageStatus.READ,
      undelivered: MessageStatus.FAILED,
      failed: MessageStatus.FAILED,
    };
    const mapped = map[dto.status?.toLowerCase()];
    if (!mapped) return { updated: 0 };
    const res = await this.prisma.message.updateMany({
      where: { externalId: dto.externalId },
      data: { status: mapped },
    });
    return { updated: res.count };
  }

  // ── Templates ────────────────────────────────
  listTemplates(tenantId: string) {
    return this.prisma.smsTemplate.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  createTemplate(tenantId: string, data: { name: string; body: string }) {
    return this.prisma.smsTemplate.create({ data: { tenantId, ...data } });
  }

  async updateTemplate(
    tenantId: string,
    id: string,
    data: { name?: string; body?: string },
  ) {
    const existing = await this.prisma.smsTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('SMS template not found');
    return this.prisma.smsTemplate.update({ where: { id }, data });
  }

  async removeTemplate(tenantId: string, id: string) {
    const existing = await this.prisma.smsTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('SMS template not found');
    await this.prisma.smsTemplate.delete({ where: { id } });
    return { success: true };
  }

  // ── DND / opt-out list ───────────────────────
  listOptOuts(tenantId: string) {
    return this.prisma.smsOptOut.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  addOptOut(tenantId: string, phone: string, reason = 'manual') {
    const normalized = this.normalize(phone);
    return this.prisma.smsOptOut.upsert({
      where: { tenantId_phone: { tenantId, phone: normalized } },
      update: { reason },
      create: { tenantId, phone: normalized, reason },
    });
  }

  private async removeOptOutByPhone(tenantId: string, phone: string) {
    await this.prisma.smsOptOut.deleteMany({
      where: { tenantId, phone: this.normalize(phone) },
    });
  }

  async removeOptOut(tenantId: string, id: string) {
    const existing = await this.prisma.smsOptOut.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Opt-out entry not found');
    await this.prisma.smsOptOut.delete({ where: { id } });
    return { success: true };
  }

  // ── OTP verification ─────────────────────────
  /**
   * Sends a 6-digit code. Only the hash is stored, and the code is never
   * threaded into the inbox. Transactional OTPs are exempt from DND scrubbing,
   * so the opt-out list is deliberately not consulted here.
   */
  async sendOtp(tenantId: string, phone: string) {
    const normalized = this.normalize(phone);
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // Supersede any codes still outstanding for this number.
    await this.prisma.smsOtp.deleteMany({
      where: { tenantId, phone: normalized, consumedAt: null },
    });

    await this.prisma.smsOtp.create({
      data: {
        tenantId,
        phone: normalized,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    await this.provider.send({
      to: phone,
      text: `Your verification code is ${code}. It expires in 5 minutes.`,
    });

    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  async verifyOtp(tenantId: string, phone: string, code: string) {
    const normalized = this.normalize(phone);
    const otp = await this.prisma.smsOtp.findFirst({
      where: { tenantId, phone: normalized, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new BadRequestException('No verification code pending');
    if (otp.expiresAt < new Date()) {
      throw new BadRequestException('Verification code expired');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many attempts - request a new code');
    }

    if (!(await bcrypt.compare(code, otp.codeHash))) {
      await this.prisma.smsOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.smsOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return { verified: true };
  }
}
