import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { InvoiceStatus, Prisma, QuoteStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from './products.service';
import { priceQuote, PricedLineInput } from './pricing';
import {
  AcceptQuoteDto,
  CreateDiscountRuleDto,
  CreateInvoiceDto,
  CreateQuoteDto,
  QueryQuotesDto,
  QuoteLineDto,
  UpdateQuoteDto,
} from './dto/cpq.dto';

/** States a quote can still be edited in. */
const EDITABLE: QuoteStatus[] = [
  QuoteStatus.DRAFT,
  QuoteStatus.REJECTED,
  QuoteStatus.PENDING_APPROVAL,
];

@Injectable()
export class QuotesService {
  private readonly logger = new Logger('QuotesService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  // ── Numbering ────────────────────────────────

  /** Q-2026-0007, sequential within the tenant and year. */
  private async nextNumber(tenantId: string, prefix: 'Q' | 'INV') {
    const year = new Date().getFullYear();
    const stem = `${prefix}-${year}-`;

    const last =
      prefix === 'Q'
        ? await this.prisma.quote.findFirst({
            where: { tenantId, number: { startsWith: stem } },
            orderBy: { number: 'desc' },
            select: { number: true },
          })
        : await this.prisma.invoice.findFirst({
            where: { tenantId, number: { startsWith: stem } },
            orderBy: { number: 'desc' },
            select: { number: true },
          });

    const next = last ? Number(last.number.slice(stem.length)) + 1 : 1;
    return `${stem}${String(next).padStart(4, '0')}`;
  }

  // ── Discount policy ──────────────────────────

  /**
   * How much discount this role may give unilaterally. The first active rule
   * matching their role wins; with no rules configured, nothing needs approval.
   */
  async discountLimit(
    tenantId: string,
    role: Role,
  ): Promise<{ max: number; approverRole: Role } | null> {
    const rules = await this.prisma.discountRule.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    for (const rule of rules) {
      const applies =
        rule.appliesToRoles.length === 0 || rule.appliesToRoles.includes(role);
      if (applies) {
        return {
          max: Number(rule.maxDiscountPercent),
          approverRole: rule.approverRole,
        };
      }
    }
    return null;
  }

  /** The largest discount anywhere on the quote, header or line. */
  private maxDiscountOn(lines: QuoteLineDto[], headerPercent: number): number {
    return Math.max(
      headerPercent,
      ...lines.map((l) => Number(l.discountPercent ?? 0)),
      0,
    );
  }

  // ── Building lines ───────────────────────────

  /**
   * Fills in each line from the catalogue: an unpriced line takes the price
   * book's price, then the product's list price; name and tax rate likewise.
   */
  private async resolveLines(
    tenantId: string,
    lines: QuoteLineDto[],
    priceBookId?: string | null,
  ) {
    return Promise.all(
      lines.map(async (line, index) => {
        let name = line.name;
        let unitPrice = line.unitPrice;
        let taxRate = line.taxRate;

        if (line.productId) {
          const product = await this.products.getProduct(
            tenantId,
            line.productId,
          );
          name = name ?? product.name;
          taxRate = taxRate ?? Number(product.taxRate);
          unitPrice =
            unitPrice ??
            (await this.products.resolvePrice(
              tenantId,
              line.productId,
              priceBookId,
            ));
        }

        if (!name) {
          throw new BadRequestException(
            'A line without a product needs a name',
          );
        }
        if (unitPrice === undefined) {
          throw new BadRequestException(`No price available for "${name}"`);
        }

        return {
          productId: line.productId ?? null,
          name,
          description: line.description ?? null,
          quantity: Number(line.quantity),
          unitPrice: Number(unitPrice),
          discountPercent: Number(line.discountPercent ?? 0),
          taxRate: Number(taxRate ?? 0),
          position: index,
        };
      }),
    );
  }

  private async writeLines(
    tenantId: string,
    quoteId: string,
    resolved: Awaited<ReturnType<QuotesService['resolveLines']>>,
    headerDiscountPercent: number,
  ) {
    const totals = priceQuote(
      resolved as unknown as PricedLineInput[],
      headerDiscountPercent,
    );

    await this.prisma.quoteLine.deleteMany({ where: { quoteId } });
    await this.prisma.quoteLine.createMany({
      data: resolved.map((line, i) => ({
        tenantId,
        quoteId,
        productId: line.productId,
        name: line.name,
        description: line.description,
        quantity: new Prisma.Decimal(line.quantity),
        unitPrice: new Prisma.Decimal(line.unitPrice),
        discountPercent: new Prisma.Decimal(line.discountPercent),
        taxRate: new Prisma.Decimal(line.taxRate),
        lineTotal: new Prisma.Decimal(totals.lines[i].lineTotal),
        position: line.position,
      })),
    });

    return totals;
  }

  // ── CRUD ─────────────────────────────────────

  listQuotes(tenantId: string, query: QueryQuotesDto) {
    return this.prisma.quote.findMany({
      where: {
        tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.dealId ? { dealId: query.dealId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
    });
  }

  async getQuote(tenantId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, tenantId },
      include: {
        lines: { orderBy: { position: 'asc' } },
        contact: true,
        company: true,
        deal: { select: { id: true, title: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }

  async createQuote(
    tenantId: string,
    userId: string,
    role: Role,
    dto: CreateQuoteDto,
  ) {
    const priceBookId =
      dto.priceBookId ??
      (
        await this.prisma.priceBook.findFirst({
          where: { tenantId, isDefault: true, isActive: true },
          select: { id: true },
        })
      )?.id ??
      null;

    const resolved = await this.resolveLines(tenantId, dto.lines, priceBookId);
    const headerDiscount = Number(dto.discountPercent ?? 0);

    const limit = await this.discountLimit(tenantId, role);
    const requested = this.maxDiscountOn(dto.lines, headerDiscount);
    const needsApproval = Boolean(limit && requested > limit.max);

    const quote = await this.prisma.quote.create({
      data: {
        tenantId,
        number: await this.nextNumber(tenantId, 'Q'),
        status: needsApproval
          ? QuoteStatus.PENDING_APPROVAL
          : QuoteStatus.DRAFT,
        approvalRequired: needsApproval,
        dealId: dto.dealId,
        contactId: dto.contactId,
        companyId: dto.companyId,
        priceBookId,
        currency: dto.currency ?? 'INR',
        discountPercent: new Prisma.Decimal(headerDiscount),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes,
        terms: dto.terms,
        publicToken: randomBytes(24).toString('base64url'),
        createdById: userId,
      },
    });

    const totals = await this.writeLines(
      tenantId,
      quote.id,
      resolved,
      headerDiscount,
    );

    return this.saveTotals(quote.id, totals);
  }

  private saveTotals(quoteId: string, totals: ReturnType<typeof priceQuote>) {
    return this.prisma.quote.update({
      where: { id: quoteId },
      data: {
        subtotal: new Prisma.Decimal(totals.subtotal),
        discountAmount: new Prisma.Decimal(totals.discountAmount),
        taxAmount: new Prisma.Decimal(totals.taxAmount),
        total: new Prisma.Decimal(totals.total),
      },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
  }

  async updateQuote(
    tenantId: string,
    id: string,
    role: Role,
    dto: UpdateQuoteDto,
  ) {
    const quote = await this.getQuote(tenantId, id);
    if (!EDITABLE.includes(quote.status)) {
      throw new BadRequestException(
        `A ${quote.status.toLowerCase().replace('_', ' ')} quote can no longer be edited`,
      );
    }

    const headerDiscount = dto.discountPercent ?? Number(quote.discountPercent);

    // Re-check the discount policy: an edit can push a quote over the line.
    const linesForCheck: QuoteLineDto[] =
      dto.lines ??
      quote.lines.map((l) => ({
        quantity: Number(l.quantity),
        discountPercent: Number(l.discountPercent),
      }));
    const limit = await this.discountLimit(tenantId, role);
    const requested = this.maxDiscountOn(linesForCheck, headerDiscount);
    const needsApproval = Boolean(limit && requested > limit.max);

    await this.prisma.quote.update({
      where: { id },
      data: {
        discountPercent: new Prisma.Decimal(headerDiscount),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        notes: dto.notes,
        terms: dto.terms,
        approvalRequired: needsApproval,
        status: needsApproval
          ? QuoteStatus.PENDING_APPROVAL
          : QuoteStatus.DRAFT,
        // An edit invalidates a previous approval.
        approvedById: null,
        approvedAt: null,
        rejectionReason: null,
      },
    });

    const resolved = dto.lines
      ? await this.resolveLines(tenantId, dto.lines, quote.priceBookId)
      : quote.lines.map((l, i) => ({
          productId: l.productId,
          name: l.name,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPercent: Number(l.discountPercent),
          taxRate: Number(l.taxRate),
          position: i,
        }));

    const totals = await this.writeLines(
      tenantId,
      id,
      resolved,
      headerDiscount,
    );
    return this.saveTotals(id, totals);
  }

  async removeQuote(tenantId: string, id: string) {
    const quote = await this.getQuote(tenantId, id);
    if (quote.status === QuoteStatus.ACCEPTED) {
      throw new BadRequestException('An accepted quote cannot be deleted');
    }
    await this.prisma.quote.delete({ where: { id } });
    return { success: true };
  }

  // ── Approval ─────────────────────────────────

  async approve(tenantId: string, id: string, userId: string, role: Role) {
    const quote = await this.getQuote(tenantId, id);
    if (quote.status !== QuoteStatus.PENDING_APPROVAL) {
      throw new BadRequestException('This quote is not awaiting approval');
    }

    const limit = await this.discountLimit(tenantId, role);
    const approverRole = limit?.approverRole ?? Role.MANAGER;
    if (role !== Role.TENANT_ADMIN && role !== approverRole) {
      throw new ForbiddenException(
        `Only ${approverRole} or an admin can approve this discount`,
      );
    }
    // Nobody signs off on their own discount.
    if (quote.createdById === userId && role !== Role.TENANT_ADMIN) {
      throw new ForbiddenException('You cannot approve your own quote');
    }

    return this.prisma.quote.update({
      where: { id },
      data: {
        status: QuoteStatus.APPROVED,
        approvedById: userId,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });
  }

  async reject(tenantId: string, id: string, userId: string, reason: string) {
    const quote = await this.getQuote(tenantId, id);
    if (quote.status !== QuoteStatus.PENDING_APPROVAL) {
      throw new BadRequestException('This quote is not awaiting approval');
    }

    return this.prisma.quote.update({
      where: { id },
      data: {
        status: QuoteStatus.REJECTED,
        rejectionReason: reason,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
  }

  // ── Sending & customer response ──────────────

  async send(tenantId: string, id: string) {
    const quote = await this.getQuote(tenantId, id);

    if (quote.approvalRequired && quote.status !== QuoteStatus.APPROVED) {
      throw new BadRequestException(
        'This discount needs approval before the quote can be sent',
      );
    }
    const SENDABLE: QuoteStatus[] = [
      QuoteStatus.DRAFT,
      QuoteStatus.APPROVED,
      QuoteStatus.SENT,
    ];
    if (!SENDABLE.includes(quote.status)) {
      throw new BadRequestException(
        `A ${quote.status.toLowerCase()} quote cannot be sent`,
      );
    }

    return this.prisma.quote.update({
      where: { id },
      data: { status: QuoteStatus.SENT, sentAt: new Date() },
    });
  }

  /** The customer-facing view, addressed only by its unguessable token. */
  async getByToken(token: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { publicToken: token },
      include: {
        lines: { orderBy: { position: 'asc' } },
        contact: { select: { firstName: true, lastName: true, email: true } },
        company: { select: { name: true } },
        tenant: { select: { name: true } },
      },
    });
    if (!quote) throw new NotFoundException('Quote not found');

    // A quote that has not been sent is not public yet.
    const NOT_PUBLIC: QuoteStatus[] = [
      QuoteStatus.DRAFT,
      QuoteStatus.PENDING_APPROVAL,
      QuoteStatus.REJECTED,
    ];
    if (NOT_PUBLIC.includes(quote.status)) {
      throw new NotFoundException('Quote not found');
    }

    const expired =
      quote.validUntil !== null && quote.validUntil.getTime() < Date.now();

    return { ...quote, expired, publicToken: undefined };
  }

  async acceptByToken(token: string, dto: AcceptQuoteDto, ip?: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { publicToken: token },
    });
    if (!quote || quote.status === QuoteStatus.DRAFT) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.status === QuoteStatus.ACCEPTED) {
      throw new BadRequestException('This quote has already been accepted');
    }
    if (quote.status !== QuoteStatus.SENT) {
      throw new BadRequestException('This quote is not open for acceptance');
    }
    if (quote.validUntil && quote.validUntil.getTime() < Date.now()) {
      throw new BadRequestException('This quote has expired');
    }

    return this.prisma.quote.update({
      where: { id: quote.id },
      data: {
        status: QuoteStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedByName: dto.name,
        acceptedByEmail: dto.email,
        acceptedIp: ip,
      },
      select: { id: true, number: true, status: true, acceptedAt: true },
    });
  }

  async declineByToken(token: string, reason?: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { publicToken: token },
    });
    if (!quote || quote.status !== QuoteStatus.SENT) {
      throw new NotFoundException('Quote not found');
    }

    return this.prisma.quote.update({
      where: { id: quote.id },
      data: {
        status: QuoteStatus.DECLINED,
        declinedAt: new Date(),
        declineReason: reason,
      },
      select: { id: true, number: true, status: true },
    });
  }

  /** Marks quotes past their validity as expired. */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStale(): Promise<void> {
    const result = await this.prisma.quote.updateMany({
      where: {
        status: QuoteStatus.SENT,
        validUntil: { not: null, lt: new Date() },
      },
      data: { status: QuoteStatus.EXPIRED },
    });
    if (result.count) this.logger.log(`Expired ${result.count} quote(s)`);
  }

  // ── Invoicing ────────────────────────────────

  /**
   * Raises an invoice from an accepted quote. Totals are copied, never
   * recomputed: the customer accepted specific figures, and a price change
   * afterwards must not silently rewrite them.
   */
  async convertToInvoice(tenantId: string, id: string, dto: CreateInvoiceDto) {
    const quote = await this.getQuote(tenantId, id);
    if (quote.status !== QuoteStatus.ACCEPTED) {
      throw new BadRequestException(
        'Only an accepted quote can be turned into an invoice',
      );
    }

    const existing = await this.prisma.invoice.findFirst({
      where: { tenantId, quoteId: id },
    });
    if (existing) {
      throw new BadRequestException(
        `Quote ${quote.number} is already invoiced as ${existing.number}`,
      );
    }

    return this.prisma.invoice.create({
      data: {
        tenantId,
        number: await this.nextNumber(tenantId, 'INV'),
        status: InvoiceStatus.ISSUED,
        quoteId: id,
        currency: quote.currency,
        subtotal: quote.subtotal,
        discountAmount: quote.discountAmount,
        taxAmount: quote.taxAmount,
        total: quote.total,
        issuedAt: new Date(),
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        customerGstin: dto.customerGstin,
      },
    });
  }

  listInvoices(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { quote: { select: { id: true, number: true } } },
    });
  }

  async markInvoicePaid(tenantId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException('A void invoice cannot be paid');
    }

    return this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.PAID, paidAt: new Date() },
    });
  }

  // ── Discount rules ───────────────────────────

  listRules(tenantId: string) {
    return this.prisma.discountRule.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  createRule(tenantId: string, dto: CreateDiscountRuleDto) {
    return this.prisma.discountRule.create({
      data: {
        tenantId,
        name: dto.name,
        isActive: dto.isActive ?? true,
        priority: dto.priority ?? 0,
        appliesToRoles: dto.appliesToRoles ?? [],
        maxDiscountPercent: new Prisma.Decimal(dto.maxDiscountPercent),
        approverRole: dto.approverRole ?? Role.MANAGER,
      },
    });
  }

  async removeRule(tenantId: string, id: string) {
    const rule = await this.prisma.discountRule.findFirst({
      where: { id, tenantId },
    });
    if (!rule) throw new NotFoundException('Discount rule not found');
    await this.prisma.discountRule.delete({ where: { id } });
    return { success: true };
  }
}
