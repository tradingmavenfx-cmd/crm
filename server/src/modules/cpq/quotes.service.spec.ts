import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QuoteStatus, Role } from '@prisma/client';
import { QuotesService } from './quotes.service';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';

const quoteRow = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  tenantId: 'tenant-1',
  number: 'Q-2026-0001',
  status: QuoteStatus.DRAFT,
  approvalRequired: false,
  createdById: 'rep-1',
  currency: 'INR',
  discountPercent: 0,
  subtotal: 1000,
  discountAmount: 0,
  taxAmount: 180,
  total: 1180,
  priceBookId: null,
  validUntil: null,
  lines: [],
  ...over,
});

describe('QuotesService', () => {
  let service: QuotesService;
  let prisma: any;
  let products: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      quote: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'q1' }),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'q1', ...data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
      },
      quoteLine: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      priceBook: { findFirst: jest.fn().mockResolvedValue(null) },
      discountRule: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'inv1', ...data }),
          ),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    products = {
      getProduct: jest.fn().mockResolvedValue({
        id: 'p1',
        name: 'CRM Licence',
        unitPrice: 1000,
        taxRate: 18,
      }),
      resolvePrice: jest.fn().mockResolvedValue(1000),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        QuotesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProductsService, useValue: products },
      ],
    }).compile();

    service = moduleRef.get(QuotesService);
  });

  // ── Numbering ──────────────────────────────────

  it('numbers the first quote of the year', async () => {
    prisma.quote.findFirst.mockResolvedValue(null);

    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      lines: [{ productId: 'p1', quantity: 1 }],
    });

    const created = prisma.quote.create.mock.calls[0][0].data;
    expect(created.number).toMatch(/^Q-\d{4}-0001$/);
  });

  it('continues the sequence from the last quote', async () => {
    prisma.quote.findFirst.mockResolvedValue({ number: 'Q-2026-0041' });

    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      lines: [{ productId: 'p1', quantity: 1 }],
    });

    expect(prisma.quote.create.mock.calls[0][0].data.number).toBe(
      'Q-2026-0042',
    );
  });

  it('gives every quote an unguessable public token', async () => {
    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      lines: [{ productId: 'p1', quantity: 1 }],
    });

    const { publicToken } = prisma.quote.create.mock.calls[0][0].data;
    expect(publicToken.length).toBeGreaterThanOrEqual(30);
  });

  // ── Line resolution ────────────────────────────

  it('takes name, price and tax rate from the catalogue', async () => {
    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      lines: [{ productId: 'p1', quantity: 2 }],
    });

    const line = prisma.quoteLine.createMany.mock.calls[0][0].data[0];
    expect(line.name).toBe('CRM Licence');
    expect(Number(line.unitPrice)).toBe(1000);
    expect(Number(line.taxRate)).toBe(18);
    expect(Number(line.lineTotal)).toBe(2000);
  });

  it('lets an explicit price override the catalogue', async () => {
    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      lines: [{ productId: 'p1', quantity: 1, unitPrice: 750 }],
    });

    expect(products.resolvePrice).not.toHaveBeenCalled();
    const line = prisma.quoteLine.createMany.mock.calls[0][0].data[0];
    expect(Number(line.unitPrice)).toBe(750);
  });

  it('rejects a free-text line with no name', async () => {
    await expect(
      service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
        lines: [{ quantity: 1, unitPrice: 100 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a free-text line with no price', async () => {
    await expect(
      service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
        lines: [{ name: 'Custom work', quantity: 1 }],
      }),
    ).rejects.toThrow('No price available');
  });

  it('stores the computed totals on the quote', async () => {
    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      lines: [{ productId: 'p1', quantity: 2 }],
    });

    const totals = prisma.quote.update.mock.calls[0][0].data;
    expect(Number(totals.subtotal)).toBe(2000);
    expect(Number(totals.taxAmount)).toBe(360);
    expect(Number(totals.total)).toBe(2360);
  });

  // ── Discount approval ──────────────────────────

  it('needs no approval when no rules are configured', async () => {
    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      discountPercent: 90,
      lines: [{ productId: 'p1', quantity: 1 }],
    });

    const created = prisma.quote.create.mock.calls[0][0].data;
    expect(created.status).toBe(QuoteStatus.DRAFT);
    expect(created.approvalRequired).toBe(false);
  });

  it('holds a quote over the role limit for approval', async () => {
    prisma.discountRule.findMany.mockResolvedValue([
      {
        appliesToRoles: [Role.SALES_REP],
        maxDiscountPercent: 10,
        approverRole: Role.MANAGER,
      },
    ]);

    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      discountPercent: 25,
      lines: [{ productId: 'p1', quantity: 1 }],
    });

    const created = prisma.quote.create.mock.calls[0][0].data;
    expect(created.status).toBe(QuoteStatus.PENDING_APPROVAL);
    expect(created.approvalRequired).toBe(true);
  });

  it('catches a discount hidden on a line, not just the header', async () => {
    prisma.discountRule.findMany.mockResolvedValue([
      {
        appliesToRoles: [],
        maxDiscountPercent: 10,
        approverRole: Role.MANAGER,
      },
    ]);

    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      discountPercent: 0,
      lines: [{ productId: 'p1', quantity: 1, discountPercent: 40 }],
    });

    expect(prisma.quote.create.mock.calls[0][0].data.approvalRequired).toBe(
      true,
    );
  });

  it('lets a role within its limit send without approval', async () => {
    prisma.discountRule.findMany.mockResolvedValue([
      {
        appliesToRoles: [Role.SALES_REP],
        maxDiscountPercent: 30,
        approverRole: Role.MANAGER,
      },
    ]);

    await service.createQuote(tenantId, 'rep-1', Role.SALES_REP, {
      discountPercent: 25,
      lines: [{ productId: 'p1', quantity: 1 }],
    });

    expect(prisma.quote.create.mock.calls[0][0].data.status).toBe(
      QuoteStatus.DRAFT,
    );
  });

  it('refuses to let someone approve their own quote', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.PENDING_APPROVAL, createdById: 'mgr-1' }),
    );
    prisma.discountRule.findMany.mockResolvedValue([
      {
        appliesToRoles: [],
        maxDiscountPercent: 10,
        approverRole: Role.MANAGER,
      },
    ]);

    await expect(
      service.approve(tenantId, 'q1', 'mgr-1', Role.MANAGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets the approver role approve someone else's quote", async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.PENDING_APPROVAL, createdById: 'rep-1' }),
    );
    prisma.discountRule.findMany.mockResolvedValue([
      {
        appliesToRoles: [],
        maxDiscountPercent: 10,
        approverRole: Role.MANAGER,
      },
    ]);

    const approved = await service.approve(
      tenantId,
      'q1',
      'mgr-1',
      Role.MANAGER,
    );

    expect(approved.status).toBe(QuoteStatus.APPROVED);
    expect(approved.approvedById).toBe('mgr-1');
  });

  it('will not approve a quote that is not awaiting approval', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.DRAFT }),
    );

    await expect(
      service.approve(tenantId, 'q1', 'mgr-1', Role.MANAGER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── Sending ────────────────────────────────────

  it('blocks sending a quote whose discount is still unapproved', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({
        status: QuoteStatus.PENDING_APPROVAL,
        approvalRequired: true,
      }),
    );

    await expect(service.send(tenantId, 'q1')).rejects.toThrow(
      'needs approval',
    );
  });

  it('sends an approved quote', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.APPROVED, approvalRequired: true }),
    );

    const sent = await service.send(tenantId, 'q1');

    expect(sent.status).toBe(QuoteStatus.SENT);
    expect(sent.sentAt).toBeInstanceOf(Date);
  });

  it('will not re-send an accepted quote', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.ACCEPTED }),
    );

    await expect(service.send(tenantId, 'q1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ── Editing ────────────────────────────────────

  it('refuses to edit a sent quote', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.SENT }),
    );

    await expect(
      service.updateQuote(tenantId, 'q1', Role.MANAGER, { discountPercent: 5 }),
    ).rejects.toThrow('can no longer be edited');
  });

  it('an edit clears a previous approval', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.APPROVED, lines: [] }),
    );
    // APPROVED is not editable, so use a rejected quote being reworked.
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.REJECTED, lines: [] }),
    );

    await service.updateQuote(tenantId, 'q1', Role.MANAGER, {
      discountPercent: 5,
    });

    const patch = prisma.quote.update.mock.calls[0][0].data;
    expect(patch.approvedById).toBeNull();
    expect(patch.approvedAt).toBeNull();
  });

  // ── Customer-facing ────────────────────────────

  it('hides a draft quote from the public link', async () => {
    prisma.quote.findUnique.mockResolvedValue(
      quoteRow({ status: QuoteStatus.DRAFT, publicToken: 'tok' }),
    );

    await expect(service.getByToken('tok')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('never leaks the token back in the public payload', async () => {
    prisma.quote.findUnique.mockResolvedValue(
      quoteRow({
        status: QuoteStatus.SENT,
        publicToken: 'tok',
        tenant: { name: 'Acme' },
      }),
    );

    const view = await service.getByToken('tok');

    expect(view.publicToken).toBeUndefined();
  });

  it('flags an expired quote on the public view', async () => {
    prisma.quote.findUnique.mockResolvedValue(
      quoteRow({
        status: QuoteStatus.SENT,
        validUntil: new Date(Date.now() - 86400000),
      }),
    );

    const view = await service.getByToken('tok');
    expect(view.expired).toBe(true);
  });

  it('records who accepted, and when', async () => {
    prisma.quote.findUnique.mockResolvedValue(
      quoteRow({ status: QuoteStatus.SENT }),
    );

    await service.acceptByToken(
      'tok',
      { name: 'Priya Sharma', email: 'priya@globex.in' },
      '203.0.113.4',
    );

    const patch = prisma.quote.update.mock.calls[0][0].data;
    expect(patch).toMatchObject({
      status: QuoteStatus.ACCEPTED,
      acceptedByName: 'Priya Sharma',
      acceptedIp: '203.0.113.4',
    });
  });

  it('refuses to accept the same quote twice', async () => {
    prisma.quote.findUnique.mockResolvedValue(
      quoteRow({ status: QuoteStatus.ACCEPTED }),
    );

    await expect(
      service.acceptByToken('tok', { name: 'Priya' }),
    ).rejects.toThrow('already been accepted');
  });

  it('refuses to accept an expired quote', async () => {
    prisma.quote.findUnique.mockResolvedValue(
      quoteRow({
        status: QuoteStatus.SENT,
        validUntil: new Date(Date.now() - 1000),
      }),
    );

    await expect(
      service.acceptByToken('tok', { name: 'Priya' }),
    ).rejects.toThrow('expired');
  });

  // ── Invoicing ──────────────────────────────────

  it('invoices only an accepted quote', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.SENT }),
    );

    await expect(service.convertToInvoice(tenantId, 'q1', {})).rejects.toThrow(
      'Only an accepted quote',
    );
  });

  it('copies the accepted totals onto the invoice rather than recomputing', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({
        status: QuoteStatus.ACCEPTED,
        subtotal: 2000,
        discountAmount: 200,
        taxAmount: 324,
        total: 2124,
      }),
    );

    const invoice = await service.convertToInvoice(tenantId, 'q1', {
      customerGstin: '29ABCDE1234F1Z5',
    });

    expect(invoice).toMatchObject({
      subtotal: 2000,
      discountAmount: 200,
      taxAmount: 324,
      total: 2124,
      customerGstin: '29ABCDE1234F1Z5',
    });
    expect(invoice.number).toMatch(/^INV-\d{4}-0001$/);
  });

  it('will not invoice the same quote twice', async () => {
    prisma.quote.findFirst.mockResolvedValue(
      quoteRow({ status: QuoteStatus.ACCEPTED }),
    );
    prisma.invoice.findFirst.mockResolvedValue({ number: 'INV-2026-0001' });

    await expect(service.convertToInvoice(tenantId, 'q1', {})).rejects.toThrow(
      'already invoiced',
    );
  });

  // ── Housekeeping ───────────────────────────────

  it('expires sent quotes past their validity', async () => {
    prisma.quote.updateMany.mockResolvedValue({ count: 3 });

    await service.expireStale();

    expect(prisma.quote.updateMany).toHaveBeenCalledWith({
      where: {
        status: QuoteStatus.SENT,
        validUntil: { not: null, lt: expect.any(Date) },
      },
      data: { status: QuoteStatus.EXPIRED },
    });
  });

  it('scopes quote lookups to the tenant', async () => {
    prisma.quote.findFirst.mockResolvedValue(null);
    await expect(service.getQuote(tenantId, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
