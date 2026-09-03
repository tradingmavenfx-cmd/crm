import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadsService } from './leads.service';
import {
  CreateFormDto,
  CreatePageDto,
  SubmitFormDto,
  UpdateFormDto,
  UpdatePageDto,
} from './dto/marketing.dto';

export interface PageBlock {
  type: 'heading' | 'text' | 'image' | 'form' | 'button';
  text?: string;
  src?: string;
  alt?: string;
  href?: string;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'page';

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  // ── Forms ────────────────────────────────────

  listForms(tenantId: string) {
    return this.prisma.marketingForm.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        assignTo: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { submissions: true, pages: true } },
      },
    });
  }

  createForm(tenantId: string, dto: CreateFormDto) {
    return this.prisma.marketingForm.create({
      data: {
        tenantId,
        name: dto.name,
        fields: (dto.fields ?? []) as unknown as Prisma.InputJsonValue,
        assignToId: dto.assignToId,
        sequenceId: dto.sequenceId,
        thankYou: dto.thankYou,
      },
    });
  }

  async updateForm(tenantId: string, id: string, dto: UpdateFormDto) {
    const form = await this.prisma.marketingForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) throw new NotFoundException('Form not found');

    return this.prisma.marketingForm.update({
      where: { id },
      data: {
        name: dto.name,
        fields: dto.fields as unknown as Prisma.InputJsonValue,
        assignToId: dto.assignToId === '' ? null : dto.assignToId,
        sequenceId: dto.sequenceId === '' ? null : dto.sequenceId,
        thankYou: dto.thankYou,
      },
    });
  }

  async removeForm(tenantId: string, id: string) {
    await this.prisma.marketingForm.deleteMany({ where: { id, tenantId } });
    return { success: true };
  }

  listSubmissions(tenantId: string, formId?: string) {
    return this.prisma.formSubmission.findMany({
      where: { tenantId, ...(formId ? { formId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        form: { select: { name: true } },
        page: { select: { title: true, slug: true } },
        lead: {
          select: { id: true, firstName: true, lastName: true, score: true },
        },
      },
    });
  }

  // ── Pages ────────────────────────────────────

  listPages(tenantId: string) {
    return this.prisma.landingPage.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      include: {
        form: { select: { id: true, name: true } },
        variantOf: { select: { id: true, title: true } },
        _count: { select: { variants: true } },
      },
    });
  }

  async getPage(tenantId: string, id: string) {
    const page = await this.prisma.landingPage.findFirst({
      where: { id, tenantId },
      include: {
        form: true,
        variants: {
          select: {
            id: true,
            title: true,
            slug: true,
            views: true,
            submissions: true,
            variantWeight: true,
          },
        },
      },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  private async uniqueSlug(tenantId: string, base: string) {
    let slug = base;
    let n = 2;
    // A clash gets a suffix rather than an error: a marketer naming two pages
    // the same thing is not a mistake worth blocking on.
    while (
      await this.prisma.landingPage.findFirst({
        where: { tenantId, slug },
        select: { id: true },
      })
    ) {
      slug = `${base}-${n}`;
      n += 1;
    }
    return slug;
  }

  async createPage(tenantId: string, dto: CreatePageDto) {
    const slug = await this.uniqueSlug(
      tenantId,
      dto.slug ?? slugify(dto.title),
    );

    return this.prisma.landingPage.create({
      data: {
        tenantId,
        slug,
        title: dto.title,
        blocks: (dto.blocks ?? []) as unknown as Prisma.InputJsonValue,
        formId: dto.formId,
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        variantOfId: dto.variantOfId,
        variantWeight: dto.variantWeight ?? 50,
      },
    });
  }

  async updatePage(tenantId: string, id: string, dto: UpdatePageDto) {
    await this.getPage(tenantId, id);

    return this.prisma.landingPage.update({
      where: { id },
      data: {
        title: dto.title,
        blocks: dto.blocks as unknown as Prisma.InputJsonValue,
        formId: dto.formId === '' ? null : dto.formId,
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        variantWeight: dto.variantWeight,
      },
    });
  }

  async publishPage(tenantId: string, id: string) {
    const page = await this.getPage(tenantId, id);
    if (!page.blocks || (page.blocks as unknown as PageBlock[]).length === 0) {
      throw new BadRequestException('An empty page has nothing to publish');
    }

    return this.prisma.landingPage.update({
      where: { id },
      data: { status: PageStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  async unpublishPage(tenantId: string, id: string) {
    await this.getPage(tenantId, id);
    return this.prisma.landingPage.update({
      where: { id },
      data: { status: PageStatus.ARCHIVED },
    });
  }

  async removePage(tenantId: string, id: string) {
    await this.getPage(tenantId, id);
    await this.prisma.landingPage.delete({ where: { id } });
    return { success: true };
  }

  // ── The public page ──────────────────────────

  /**
   * Serves a published page, picking between A/B variants by weight.
   *
   * The split is per view, so the counts on each variant are the number of
   * people who actually saw it — which is the only denominator a conversion
   * rate can honestly use.
   */
  async publicPage(tenantId: string, slug: string) {
    const page = await this.prisma.landingPage.findFirst({
      where: { tenantId, slug, status: PageStatus.PUBLISHED },
      include: {
        form: true,
        variants: { where: { status: PageStatus.PUBLISHED } },
        tenant: { select: { name: true } },
      },
    });
    if (!page) throw new NotFoundException('Page not found');

    const candidates = [page, ...page.variants];
    const chosen = this.pickVariant(candidates);

    await this.prisma.landingPage.update({
      where: { id: chosen.id },
      data: { views: { increment: 1 } },
    });

    // Variants test the wording, not the form: both sides ask the same
    // questions, or the two conversion rates would not be comparable.
    const form = page.form;

    return {
      // The id is returned because the form has to post back against the
      // variant that was actually shown, not the one that was asked for.
      variantId: chosen.id,
      slug: chosen.slug,
      title: chosen.title,
      metaTitle: chosen.metaTitle ?? chosen.title,
      metaDescription: chosen.metaDescription,
      blocks: chosen.blocks,
      tenant: page.tenant,
      form: form
        ? { id: form.id, fields: form.fields, thankYou: form.thankYou }
        : null,
    };
  }

  /** Weighted pick across a page and its variants. */
  private pickVariant<T extends { variantWeight: number }>(options: T[]): T {
    if (options.length === 1) return options[0];
    const total = options.reduce(
      (sum, o) => sum + Math.max(0, o.variantWeight),
      0,
    );
    if (total <= 0) return options[0];

    let roll = Math.random() * total;
    for (const option of options) {
      roll -= Math.max(0, option.variantWeight);
      if (roll <= 0) return option;
    }
    return options[options.length - 1];
  }

  /**
   * Takes a submission from a public page.
   *
   * The submission is recorded whatever happens to the lead: a form that
   * silently loses what somebody typed is worse than one that duplicates.
   */
  async submit(tenantId: string, formId: string, dto: SubmitFormDto) {
    const form = await this.prisma.marketingForm.findFirst({
      where: { id: formId, tenantId },
    });
    if (!form) throw new NotFoundException('Form not found');

    const page = dto.pageId
      ? await this.prisma.landingPage.findFirst({
          where: { id: dto.pageId, tenantId },
          select: { id: true, title: true, slug: true },
        })
      : null;

    const data = dto.data ?? {};
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const value = data[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return undefined;
    };

    const lead = await this.leads.capture(tenantId, {
      firstName: pick('firstName', 'first_name', 'name') ?? 'Unknown',
      lastName: pick('lastName', 'last_name'),
      email: pick('email'),
      phone: pick('phone', 'mobile'),
      company: pick('company', 'organisation', 'organization'),
      jobTitle: pick('jobTitle', 'title', 'role'),
      source: page ? 'landing_page' : 'web_form',
      sourceDetail: page?.slug ?? form.name,
      utmSource: dto.utm?.utm_source,
      utmMedium: dto.utm?.utm_medium,
      utmCampaign: dto.utm?.utm_campaign,
      utmTerm: dto.utm?.utm_term,
      utmContent: dto.utm?.utm_content,
      ownerId: form.assignToId ?? undefined,
      fields: data,
    });

    await this.prisma.formSubmission.create({
      data: {
        tenantId,
        formId,
        pageId: page?.id,
        leadId: lead.id,
        data: data as unknown as Prisma.InputJsonValue,
        utm: (dto.utm ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });

    await this.leads.recordTouch(
      tenantId,
      lead.id,
      'form_submit',
      { form: form.name },
      page ? { pageId: page.id } : {},
    );

    if (page) {
      await this.prisma.landingPage.update({
        where: { id: page.id },
        data: { submissions: { increment: 1 } },
      });
    }

    // The lead id is not handed back: the page has no business holding a
    // reference to a CRM record.
    return { received: true, message: form.thankYou };
  }

  /** Records that somebody looked at a page, without submitting anything. */
  async recordView(tenantId: string, pageId: string) {
    const page = await this.prisma.landingPage.findFirst({
      where: { id: pageId, tenantId, status: PageStatus.PUBLISHED },
      select: { id: true },
    });
    if (!page) throw new NotFoundException('Page not found');

    await this.leads.recordTouch(
      tenantId,
      null,
      'page_view',
      {},
      {
        pageId: page.id,
      },
    );
    return { recorded: true };
  }

  /** How each page and its variants are converting. */
  async pageStats(tenantId: string) {
    const pages = await this.prisma.landingPage.findMany({
      where: { tenantId },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        views: true,
        submissions: true,
        variantOfId: true,
        variantWeight: true,
      },
      orderBy: { views: 'desc' },
    });

    return pages.map((p) => ({
      ...p,
      // Rounded to a whole percent: a landing page with 3 views does not have
      // a meaningful third decimal place.
      conversionRate: p.views ? Math.round((p.submissions / p.views) * 100) : 0,
    }));
  }
}
