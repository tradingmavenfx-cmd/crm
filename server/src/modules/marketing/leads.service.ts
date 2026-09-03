import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CaptureLeadDto,
  ConvertLeadDto,
  CreateLeadDto,
  QueryLeadsDto,
  UpdateLeadDto,
} from './dto/marketing.dto';

/**
 * A lead's score, from what is known about it.
 *
 * Deliberately the same shape as the rest of the scoring in this codebase:
 * a handful of stated reasons that add up, so a rep can be told why a lead is
 * worth calling rather than being handed a number.
 */
export interface ScoreFactor {
  label: string;
  points: number;
}

const FREE_MAIL = [
  'gmail.com',
  'yahoo.com',
  'yahoo.in',
  'hotmail.com',
  'outlook.com',
  'rediffmail.com',
  'icloud.com',
];

export function scoreLead(lead: {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  source?: string | null;
  utmSource?: string | null;
}): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];

  if (lead.email) factors.push({ label: 'Gave an email address', points: 15 });
  if (lead.phone) factors.push({ label: 'Gave a phone number', points: 15 });
  if (lead.company) factors.push({ label: 'Named their company', points: 10 });

  const domain = lead.email?.split('@')[1]?.toLowerCase();
  if (domain && !FREE_MAIL.includes(domain)) {
    // A work address is a company that can be looked up and sold to.
    factors.push({ label: 'Work email, not a free one', points: 20 });
  }

  const title = lead.jobTitle?.toLowerCase() ?? '';
  if (/(chief|ceo|cto|cfo|coo|founder|owner|director|vp|head)/.test(title)) {
    factors.push({ label: 'Seniority in their job title', points: 20 });
  } else if (title) {
    factors.push({ label: 'Gave a job title', points: 5 });
  }

  // Someone who filled in a form on your own page beats a bought list.
  if (lead.source === 'landing_page' || lead.source === 'web_form') {
    factors.push({
      label: 'Came to us, rather than being imported',
      points: 15,
    });
  }
  if (lead.utmSource === 'referral') {
    factors.push({ label: 'Arrived by referral', points: 10 });
  }

  const score = Math.min(
    100,
    factors.reduce((total, f) => total + f.points, 0),
  );
  return { score, factors };
}

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whoever is carrying the fewest leads that are still to be worked.
   *
   * Deliberately counted on open leads rather than on open conversations, the
   * way inbound chat is shared out: a rep buried in leads is busy even if
   * nobody has messaged them.
   */
  private async nextOwner(tenantId: string): Promise<string | null> {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { not: 'VIEWER' } },
      select: {
        id: true,
        _count: {
          select: {
            ownedLeads: {
              where: {
                status: {
                  notIn: [LeadStatus.CONVERTED, LeadStatus.DISQUALIFIED],
                },
              },
            },
          },
        },
      },
    });
    if (!users.length) return null;

    return users.sort((a, b) => a._count.ownedLeads - b._count.ownedLeads)[0]
      .id;
  }

  list(tenantId: string, query: QueryLeadsDto) {
    const where: Prisma.LeadWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.source) where.source = query.source;
    if (query.minScore != null) where.score = { gte: query.minScore };
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.lead.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { touchpoints: true } },
      },
    });
  }

  async get(tenantId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        touchpoints: {
          orderBy: { occurredAt: 'asc' },
          include: {
            campaign: { select: { id: true, name: true } },
            page: { select: { id: true, title: true, slug: true } },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // The score is stored, but the reasons are worked out fresh so they always
    // match the lead as it stands now.
    return { ...lead, factors: scoreLead(lead).factors };
  }

  async create(tenantId: string, dto: CreateLeadDto) {
    const { score } = scoreLead({ ...dto, source: dto.source ?? 'manual' });

    return this.prisma.lead.create({
      data: {
        tenantId,
        ...dto,
        source: dto.source ?? 'manual',
        score,
        fields: (dto.fields ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateLeadDto) {
    const lead = await this.get(tenantId, id);
    if (lead.status === LeadStatus.CONVERTED) {
      throw new BadRequestException(
        'This lead has been converted; work the contact instead',
      );
    }

    const merged = { ...lead, ...dto };
    const { score } = scoreLead(merged);

    return this.prisma.lead.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        jobTitle: dto.jobTitle,
        status: dto.status,
        ownerId: dto.ownerId === '' ? null : dto.ownerId,
        disqualifiedReason: dto.disqualifiedReason,
        score,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.lead.delete({ where: { id } });
    return { success: true };
  }

  // ── Capture ──────────────────────────────────

  /**
   * Takes a lead in from outside — a form, a page, an import.
   *
   * A lead who comes back a second time is updated rather than duplicated:
   * matching on email keeps one row per person, and the second visit is
   * recorded as another touchpoint rather than a second lead.
   */
  async capture(tenantId: string, dto: CaptureLeadDto) {
    const email = dto.email?.trim().toLowerCase();

    const existing = email
      ? await this.prisma.lead.findFirst({
          where: {
            tenantId,
            email: { equals: email, mode: 'insensitive' },
            status: { not: LeadStatus.CONVERTED },
          },
        })
      : null;

    const attribution = {
      // First touch is kept: what brought them the first time is the thing
      // that worked, and overwriting it would erase that.
      source: existing?.source ?? dto.source,
      sourceDetail: existing?.sourceDetail ?? dto.sourceDetail,
      utmSource: existing?.utmSource ?? dto.utmSource,
      utmMedium: existing?.utmMedium ?? dto.utmMedium,
      utmCampaign: existing?.utmCampaign ?? dto.utmCampaign,
      utmTerm: existing?.utmTerm ?? dto.utmTerm,
      utmContent: existing?.utmContent ?? dto.utmContent,
    };

    const merged = {
      firstName: dto.firstName || existing?.firstName || 'Unknown',
      lastName: dto.lastName ?? existing?.lastName ?? null,
      email: email ?? existing?.email ?? null,
      phone: dto.phone ?? existing?.phone ?? null,
      company: dto.company ?? existing?.company ?? null,
      jobTitle: dto.jobTitle ?? existing?.jobTitle ?? null,
      ...attribution,
    };
    const { score } = scoreLead(merged);

    if (existing) {
      return this.prisma.lead.update({
        where: { id: existing.id },
        data: {
          ...merged,
          score,
          fields: {
            ...((existing.fields ?? {}) as Record<string, unknown>),
            ...(dto.fields ?? {}),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // A new lead has an owner from the moment it lands.
    const ownerId = dto.ownerId ?? (await this.nextOwner(tenantId));

    return this.prisma.lead.create({
      data: {
        tenantId,
        ...merged,
        ownerId,
        score,
        fields: (dto.fields ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Records something that happened to a lead. */
  recordTouch(
    tenantId: string,
    leadId: string | null,
    type: string,
    detail: Record<string, unknown> = {},
    links: { campaignId?: string; pageId?: string; contactId?: string } = {},
  ) {
    return this.prisma.touchpoint.create({
      data: {
        tenantId,
        leadId,
        type,
        detail: detail as unknown as Prisma.InputJsonValue,
        ...links,
      },
    });
  }

  // ── Conversion ───────────────────────────────

  /**
   * Turns a lead into a contact, optionally an account and a deal.
   *
   * The lead row is kept and marked converted rather than deleted: it is the
   * record of where the customer came from, and the touchpoints hang off it.
   * Those touchpoints are re-pointed at the new contact so the trail follows
   * the person rather than stopping at the moment they became one.
   */
  async convert(tenantId: string, id: string, dto: ConvertLeadDto) {
    const lead = await this.get(tenantId, id);
    if (lead.convertedAt) {
      throw new BadRequestException('This lead has already been converted');
    }

    let companyId = dto.companyId ?? null;
    if (!companyId && (dto.createCompany ?? true) && lead.company) {
      const existing = await this.prisma.company.findFirst({
        where: {
          tenantId,
          name: { equals: lead.company, mode: 'insensitive' },
        },
        select: { id: true },
      });
      companyId =
        existing?.id ??
        (
          await this.prisma.company.create({
            data: {
              tenantId,
              name: lead.company,
              domain: lead.email?.split('@')[1] ?? null,
              ownerId: lead.ownerId,
            },
          })
        ).id;
    }

    const contact = await this.prisma.contact.create({
      data: {
        tenantId,
        firstName: lead.firstName,
        lastName: lead.lastName ?? '',
        email: lead.email,
        phone: lead.phone,
        jobTitle: lead.jobTitle,
        companyId,
        ownerId: lead.ownerId,
        score: lead.score,
      },
    });

    let dealId: string | null = null;
    if (dto.dealTitle) {
      const stage = await this.prisma.dealStage.findFirst({
        where: { tenantId },
        orderBy: { order: 'asc' },
      });
      if (!stage) {
        throw new BadRequestException(
          'No pipeline stages exist to put a deal in',
        );
      }
      const deal = await this.prisma.deal.create({
        data: {
          tenantId,
          title: dto.dealTitle,
          value: dto.dealValue ?? 0,
          stageId: stage.id,
          companyId,
          contactId: contact.id,
          ownerId: lead.ownerId,
          expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
        },
      });
      dealId = deal.id;
    }

    // The trail follows the person.
    await this.prisma.touchpoint.updateMany({
      where: { tenantId, leadId: id },
      data: { contactId: contact.id },
    });

    await this.prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.CONVERTED,
        convertedAt: new Date(),
        convertedContactId: contact.id,
        convertedCompanyId: companyId,
        convertedDealId: dealId,
      },
    });

    return { contactId: contact.id, companyId, dealId };
  }
}
