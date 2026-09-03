import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignStatus, Channel, Contact, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  CreateCampaignDto,
  QueryCampaignsDto,
  SegmentDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger('CampaignsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly whatsapp: WhatsappService,
  ) {}

  // ── Audience ─────────────────────────────────

  /** Resolves a segment into the contacts it targets. */
  async audience(tenantId: string, segment: SegmentDto): Promise<Contact[]> {
    if (segment.contactIds?.length) {
      return this.prisma.contact.findMany({
        where: { tenantId, id: { in: segment.contactIds } },
      });
    }

    const where: Prisma.ContactWhereInput = { tenantId };
    if (segment.minScore !== undefined) where.score = { gte: segment.minScore };
    if (segment.companyId) where.companyId = segment.companyId;
    if (segment.ownerId) where.ownerId = segment.ownerId;

    return this.prisma.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The address a channel needs, or null when the contact cannot be reached. */
  private addressFor(contact: Contact, channel: Channel): string | null {
    if (channel === Channel.EMAIL) return contact.email;
    if (channel === Channel.SMS || channel === Channel.WHATSAPP) {
      return contact.phone;
    }
    return null;
  }

  /** Personalises a body with the contact's own fields. */
  private personalise(body: string, contact: Contact | null): string {
    if (!contact) return body;
    const values: Record<string, string> = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: `${contact.firstName} ${contact.lastName}`,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    };
    return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
      values[key] !== undefined ? values[key] : match,
    );
  }

  // ── CRUD ─────────────────────────────────────

  listCampaigns(tenantId: string, query: QueryCampaignsDto) {
    const where: Prisma.CampaignWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.channel) where.channel = query.channel;

    return this.prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { recipients: true } } },
    });
  }

  async getCampaign(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  /** Accepts either a create DTO or a stored campaign row (nullable fields). */
  private assertSendable(
    channel: Channel,
    dto: {
      subject?: string | null;
      templateId?: string | null;
      whatsappTemplateName?: string | null;
    },
  ) {
    if (channel === Channel.EMAIL && !dto.subject && !dto.templateId) {
      throw new BadRequestException(
        'Email campaigns need a subject or a template',
      );
    }
    if (channel === Channel.WHATSAPP && !dto.whatsappTemplateName) {
      throw new BadRequestException(
        'WhatsApp campaigns must use an approved template (whatsappTemplateName)',
      );
    }
    if (
      channel !== Channel.EMAIL &&
      channel !== Channel.SMS &&
      channel !== Channel.WHATSAPP
    ) {
      throw new BadRequestException(`Cannot run a campaign on ${channel}`);
    }
  }

  async createCampaign(
    tenantId: string,
    userId: string,
    dto: CreateCampaignDto,
  ) {
    this.assertSendable(dto.channel, dto);

    return this.prisma.campaign.create({
      data: {
        tenantId,
        createdById: userId,
        name: dto.name,
        channel: dto.channel,
        subject: dto.subject,
        body: dto.body,
        templateId: dto.templateId,
        whatsappTemplateName: dto.whatsappTemplateName,
        segment: (dto.segment ?? {}) as unknown as Prisma.InputJsonValue,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: dto.scheduledAt
          ? CampaignStatus.SCHEDULED
          : CampaignStatus.DRAFT,
      },
    });
  }

  async updateCampaign(tenantId: string, id: string, dto: UpdateCampaignDto) {
    const campaign = await this.getCampaign(tenantId, id);
    if (
      campaign.status === CampaignStatus.RUNNING ||
      campaign.status === CampaignStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `A ${campaign.status.toLowerCase()} campaign can no longer be edited`,
      );
    }

    const scheduledAt = dto.clearSchedule
      ? null
      : dto.scheduledAt
        ? new Date(dto.scheduledAt)
        : undefined;

    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name,
        subject: dto.subject,
        body: dto.body,
        templateId: dto.templateId,
        whatsappTemplateName: dto.whatsappTemplateName,
        segment: dto.segment
          ? (dto.segment as unknown as Prisma.InputJsonValue)
          : undefined,
        scheduledAt,
        status:
          scheduledAt === null
            ? CampaignStatus.DRAFT
            : scheduledAt
              ? CampaignStatus.SCHEDULED
              : undefined,
      },
    });
  }

  async removeCampaign(tenantId: string, id: string) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status === CampaignStatus.RUNNING) {
      throw new BadRequestException(
        'Cannot delete a campaign while it is running',
      );
    }
    await this.prisma.campaign.delete({ where: { id } });
    return { success: true };
  }

  async cancelCampaign(tenantId: string, id: string) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new BadRequestException('Campaign has already finished');
    }
    return this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.CANCELLED, scheduledAt: null },
    });
  }

  /** Contacts this campaign would reach, and how many are unreachable. */
  async preview(tenantId: string, id: string) {
    const campaign = await this.getCampaign(tenantId, id);
    const contacts = await this.audience(
      tenantId,
      campaign.segment as unknown as SegmentDto,
    );

    const reachable = contacts.filter((c) =>
      this.addressFor(c, campaign.channel),
    );

    return {
      total: contacts.length,
      reachable: reachable.length,
      unreachable: contacts.length - reachable.length,
      sample: reachable.slice(0, 10).map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        address: this.addressFor(c, campaign.channel),
      })),
    };
  }

  // ── Sending ──────────────────────────────────

  /**
   * Sends the campaign to its audience. Each recipient is independent: an
   * opt-out or a provider failure is recorded against that row and the rest of
   * the batch continues.
   */
  async send(tenantId: string, id: string) {
    const campaign = await this.getCampaign(tenantId, id);

    if (campaign.status === CampaignStatus.RUNNING) {
      throw new BadRequestException('Campaign is already running');
    }
    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new BadRequestException('Campaign has already been sent');
    }
    this.assertSendable(campaign.channel, campaign);

    await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.RUNNING, startedAt: new Date() },
    });

    const contacts = await this.audience(
      tenantId,
      campaign.segment as unknown as SegmentDto,
    );

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const contact of contacts) {
      const address = this.addressFor(contact, campaign.channel);

      if (!address) {
        await this.recordRecipient(tenantId, campaign.id, contact.id, '', {
          status: 'skipped',
          reason: 'no_address',
        });
        skipped++;
        continue;
      }

      try {
        const messageId = await this.deliver(
          tenantId,
          campaign,
          contact,
          address,
        );
        await this.recordRecipient(tenantId, campaign.id, contact.id, address, {
          status: 'sent',
          messageId,
          sentAt: new Date(),
        });
        // Reaching somebody is a touch. Without this the attribution report
        // could never credit a campaign with anything.
        await this.prisma.touchpoint.create({
          data: {
            tenantId,
            contactId: contact.id,
            campaignId: campaign.id,
            channel: campaign.channel,
            type: 'campaign_send',
          },
        });
        sent++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        // An opt-out is a deliberate skip, not a delivery failure.
        const optedOut = reason.toLowerCase().includes('opted out');
        await this.recordRecipient(tenantId, campaign.id, contact.id, address, {
          status: optedOut ? 'skipped' : 'failed',
          reason: optedOut ? 'opted_out' : reason,
        });
        if (optedOut) skipped++;
        else failed++;
      }
    }

    await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.COMPLETED, completedAt: new Date() },
    });

    this.logger.log(
      `Campaign "${campaign.name}" finished: ${sent} sent, ${skipped} skipped, ${failed} failed`,
    );
    return { campaignId: id, total: contacts.length, sent, skipped, failed };
  }

  private async deliver(
    tenantId: string,
    campaign: {
      id: string;
      channel: Channel;
      subject: string | null;
      body: string | null;
      templateId: string | null;
      whatsappTemplateName: string | null;
    },
    contact: Contact,
    address: string,
  ): Promise<string> {
    const body = this.personalise(campaign.body ?? '', contact);

    if (campaign.channel === Channel.EMAIL) {
      const message = await this.email.send(tenantId, {
        to: address,
        subject: this.personalise(campaign.subject ?? '', contact),
        html: body,
        templateId: campaign.templateId ?? undefined,
        campaignId: campaign.id,
      });
      return message.id;
    }

    if (campaign.channel === Channel.SMS) {
      const message = await this.sms.send(tenantId, {
        to: address,
        text: body,
        templateId: campaign.templateId ?? undefined,
      });
      return message.id;
    }

    // WhatsApp business-initiated sends must use an approved template.
    const message = await this.whatsapp.send(tenantId, {
      to: address,
      templateName: campaign.whatsappTemplateName!,
      parameters: [contact.firstName],
    });
    return message.id;
  }

  private recordRecipient(
    tenantId: string,
    campaignId: string,
    contactId: string,
    address: string,
    data: {
      status: string;
      reason?: string;
      messageId?: string;
      sentAt?: Date;
    },
  ) {
    return this.prisma.campaignRecipient.upsert({
      where: { campaignId_address: { campaignId, address } },
      update: data,
      create: { tenantId, campaignId, contactId, address, ...data },
    });
  }

  // ── Results ──────────────────────────────────

  async stats(tenantId: string, id: string) {
    await this.getCampaign(tenantId, id);

    const [byStatus, opened, clicked] = await Promise.all([
      this.prisma.campaignRecipient.groupBy({
        by: ['status'],
        where: { tenantId, campaignId: id },
        _count: { _all: true },
      }),
      this.prisma.campaignRecipient.count({
        where: { tenantId, campaignId: id, openedAt: { not: null } },
      }),
      this.prisma.campaignRecipient.count({
        where: { tenantId, campaignId: id, clickedAt: { not: null } },
      }),
    ]);

    const counts = Object.fromEntries(
      byStatus.map((r) => [r.status, r._count._all]),
    ) as Record<string, number>;
    const sent = counts.sent ?? 0;

    return {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      sent,
      skipped: counts.skipped ?? 0,
      failed: counts.failed ?? 0,
      opened,
      clicked,
      openRate: sent ? Math.round((opened / sent) * 100) : 0,
      clickRate: sent ? Math.round((clicked / sent) * 100) : 0,
    };
  }

  listRecipients(tenantId: string, id: string) {
    return this.prisma.campaignRecipient.findMany({
      where: { tenantId, campaignId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // ── Scheduler ────────────────────────────────

  /** Picks up campaigns whose scheduled time has arrived. */
  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduled(): Promise<void> {
    const due = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.SCHEDULED,
        scheduledAt: { lte: new Date() },
      },
      select: { id: true, tenantId: true, name: true },
    });

    for (const campaign of due) {
      try {
        await this.send(campaign.tenantId, campaign.id);
      } catch (err) {
        this.logger.error(
          `Scheduled campaign "${campaign.name}" failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }
}
