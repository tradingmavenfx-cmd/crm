import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Channel, TicketPriority, TicketStatus } from '@prisma/client';
import { TicketsService } from './tickets.service';
import { InboxService } from '../inbox/inbox.service';
import { PrismaService } from '../../prisma/prisma.service';

const MIN = 60 * 1000;

const ticketRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  tenantId: 'tenant-1',
  number: 'T-2026-0001',
  subject: 'Invoice is wrong',
  status: TicketStatus.OPEN,
  priority: TicketPriority.MEDIUM,
  assigneeId: null,
  conversationId: null,
  channel: null,
  slaPolicyId: null,
  mergedIntoId: null,
  firstRespondedAt: null,
  resolvedAt: null,
  closedAt: null,
  csatRating: null,
  comments: [],
  ...over,
});

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: any;
  let inbox: { reply: jest.Mock };
  let events: { emit: jest.Mock };
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      ticket: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 't1', ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 't1', ...data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        groupBy: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
      },
      ticketComment: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'c1', ...data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ticketEvent: { create: jest.fn().mockResolvedValue({}) },
      ticketRule: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      slaPolicy: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      conversation: { findFirst: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    inbox = { reply: jest.fn().mockResolvedValue({ id: 'm1' }) };
    events = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InboxService, useValue: inbox },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = moduleRef.get(TicketsService);
  });

  // ── Creation & SLA clocks ──────────────────────

  it('numbers tickets sequentially per year', async () => {
    prisma.ticket.findFirst.mockResolvedValue({ number: 'T-2026-0009' });

    await service.createTicket(tenantId, 'u1', { subject: 'Help' });

    expect(prisma.ticket.create.mock.calls[0][0].data.number).toBe(
      'T-2026-0010',
    );
  });

  it('sets SLA clocks from the priority when no policy exists', async () => {
    const before = Date.now();

    await service.createTicket(tenantId, 'u1', {
      subject: 'Down',
      priority: TicketPriority.URGENT,
    });

    const { firstResponseDueAt, resolutionDueAt } =
      prisma.ticket.create.mock.calls[0][0].data;
    // Urgent defaults: 30 minutes to respond, 4 hours to resolve.
    expect(firstResponseDueAt.getTime()).toBeGreaterThanOrEqual(
      before + 30 * MIN - 1000,
    );
    expect(resolutionDueAt.getTime()).toBeGreaterThanOrEqual(
      before + 240 * MIN - 1000,
    );
  });

  it('uses the default SLA policy when one is configured', async () => {
    prisma.slaPolicy.findFirst.mockResolvedValue({
      id: 'sla1',
      firstResponseMinutes: { HIGH: 15 },
      resolutionMinutes: { HIGH: 120 },
    });
    const before = Date.now();

    await service.createTicket(tenantId, 'u1', {
      subject: 'Urgent-ish',
      priority: TicketPriority.HIGH,
    });

    const data = prisma.ticket.create.mock.calls[0][0].data;
    expect(data.slaPolicyId).toBe('sla1');
    expect(data.firstResponseDueAt.getTime()).toBeLessThanOrEqual(
      before + 16 * MIN,
    );
  });

  it('gives every ticket an unguessable survey token', async () => {
    await service.createTicket(tenantId, 'u1', { subject: 'Help' });

    const { csatToken } = prisma.ticket.create.mock.calls[0][0].data;
    expect(csatToken.length).toBeGreaterThanOrEqual(20);
  });

  it('tells the workflow engine a ticket was raised', async () => {
    await service.createTicket(tenantId, 'u1', { subject: 'Help' });

    expect(events.emit).toHaveBeenCalledWith(
      'workflow.trigger',
      expect.objectContaining({ entity: 'ticket', trigger: 'RECORD_CREATED' }),
    );
  });

  // ── Auto-categorisation & routing ──────────────

  it('applies the first matching rule for category, priority and owner', async () => {
    prisma.ticketRule.findMany.mockResolvedValue([
      {
        conditions: { keywords: ['refund'] },
        setCategory: 'Billing',
        setPriority: TicketPriority.HIGH,
        strategy: 'specific',
        assignToId: 'billing-agent',
      },
    ]);

    await service.createTicket(tenantId, 'u1', {
      subject: 'I need a refund on my invoice',
    });

    const data = prisma.ticket.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      category: 'Billing',
      priority: TicketPriority.HIGH,
      assigneeId: 'billing-agent',
    });
  });

  it('lets an explicit value beat the rule', async () => {
    prisma.ticketRule.findMany.mockResolvedValue([
      {
        conditions: {},
        setPriority: TicketPriority.LOW,
        strategy: 'specific',
        assignToId: 'someone',
      },
    ]);

    await service.createTicket(tenantId, 'u1', {
      subject: 'Down',
      priority: TicketPriority.URGENT,
      assigneeId: 'chosen-agent',
    });

    const data = prisma.ticket.create.mock.calls[0][0].data;
    expect(data.priority).toBe(TicketPriority.URGENT);
    expect(data.assigneeId).toBe('chosen-agent');
  });

  it('skips a rule scoped to another channel', async () => {
    prisma.ticketRule.findMany.mockResolvedValue([
      {
        conditions: { channel: Channel.EMAIL },
        setCategory: 'Email only',
        strategy: 'specific',
        assignToId: 'a1',
      },
    ]);

    await service.createTicket(tenantId, 'u1', {
      subject: 'Hi',
      channel: Channel.WHATSAPP,
    });

    expect(prisma.ticket.create.mock.calls[0][0].data.category).toBeUndefined();
  });

  it('routes load-based to the agent with fewest open tickets', async () => {
    prisma.ticketRule.findMany.mockResolvedValue([
      { conditions: {}, strategy: 'load_based', assignToId: null },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'busy', _count: { assignedTickets: 9 } },
      { id: 'free', _count: { assignedTickets: 2 } },
    ]);

    await service.createTicket(tenantId, 'u1', { subject: 'Anything' });

    expect(prisma.ticket.create.mock.calls[0][0].data.assigneeId).toBe('free');
  });

  it('still raises the ticket when routing blows up', async () => {
    prisma.ticketRule.findMany.mockRejectedValue(new Error('db down'));

    await expect(
      service.createTicket(tenantId, 'u1', { subject: 'Help' }),
    ).resolves.toMatchObject({ subject: 'Help' });
  });

  // ── From a conversation ────────────────────────

  it('raises a ticket from an inbox thread, carrying the channel and contact', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv1',
      channel: Channel.WHATSAPP,
      contactId: 'c1',
      messages: [{ body: 'My order never arrived and I want a refund' }],
    });
    prisma.ticket.findFirst.mockResolvedValue(null);

    await service.fromConversation(tenantId, 'u1', 'conv1');

    const data = prisma.ticket.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      channel: Channel.WHATSAPP,
      requesterId: 'c1',
      conversationId: 'conv1',
    });
    expect(data.subject).toContain('My order never arrived');
  });

  it('refuses to raise a second ticket for the same thread', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv1',
      channel: Channel.EMAIL,
      contactId: null,
      messages: [],
    });
    prisma.ticket.findFirst.mockResolvedValue({
      id: 'old',
      number: 'T-2026-0001',
    });

    await expect(
      service.fromConversation(tenantId, 'u1', 'conv1'),
    ).rejects.toThrow('already ticket T-2026-0001');
  });

  // ── Comments ───────────────────────────────────

  it("a public reply goes out on the ticket's channel", async () => {
    prisma.ticket.findFirst.mockResolvedValue(
      ticketRow({ conversationId: 'conv1', channel: Channel.SMS }),
    );

    const comment = await service.addComment(tenantId, 't1', 'u1', {
      body: 'Refund processed today.',
    });

    expect(inbox.reply).toHaveBeenCalledWith(tenantId, 'conv1', {
      text: 'Refund processed today.',
    });
    expect(comment.deliveredOn).toBe(Channel.SMS);
  });

  it('an internal note is never sent to the customer', async () => {
    prisma.ticket.findFirst.mockResolvedValue(
      ticketRow({ conversationId: 'conv1', channel: Channel.SMS }),
    );

    const comment = await service.addComment(tenantId, 't1', 'u1', {
      body: 'Check with finance first',
      isInternal: true,
    });

    expect(inbox.reply).not.toHaveBeenCalled();
    expect(comment.deliveredOn).toBeNull();
  });

  it('records the comment even when the channel refuses it', async () => {
    prisma.ticket.findFirst.mockResolvedValue(
      ticketRow({ conversationId: 'conv1', channel: Channel.VOICE }),
    );
    inbox.reply.mockRejectedValue(
      new Error('Voice conversations cannot reply'),
    );

    const comment = await service.addComment(tenantId, 't1', 'u1', {
      body: 'Tried calling back',
    });

    expect(comment.body).toBe('Tried calling back');
    expect(comment.deliveredOn).toBeNull();
  });

  it('the first public reply stops the first-response clock', async () => {
    prisma.ticket.findFirst.mockResolvedValue(ticketRow());

    await service.addComment(tenantId, 't1', 'u1', { body: 'On it' });

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { firstRespondedAt: expect.any(Date) },
    });
  });

  it('an internal note does not stop the clock', async () => {
    prisma.ticket.findFirst.mockResolvedValue(ticketRow());

    await service.addComment(tenantId, 't1', 'u1', {
      body: 'Looking into it',
      isInternal: true,
    });

    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  // ── Status & priority ──────────────────────────

  it('resets the SLA clocks when the priority changes', async () => {
    prisma.ticket.findFirst.mockResolvedValue(
      ticketRow({ priority: TicketPriority.LOW }),
    );
    const before = Date.now();

    await service.updateTicket(tenantId, 't1', 'u1', {
      priority: TicketPriority.URGENT,
    });

    const data = prisma.ticket.update.mock.calls[0][0].data;
    expect(data.firstResponseDueAt.getTime()).toBeLessThanOrEqual(
      before + 31 * MIN,
    );
  });

  it('stamps resolvedAt when a ticket is resolved', async () => {
    prisma.ticket.findFirst.mockResolvedValue(ticketRow());

    await service.updateTicket(tenantId, 't1', 'u1', {
      status: TicketStatus.RESOLVED,
    });

    expect(
      prisma.ticket.update.mock.calls[0][0].data.resolvedAt,
    ).toBeInstanceOf(Date);
  });

  it('reopening clears the resolution stamps', async () => {
    prisma.ticket.findFirst.mockResolvedValue(
      ticketRow({ status: TicketStatus.RESOLVED, resolvedAt: new Date() }),
    );

    await service.updateTicket(tenantId, 't1', 'u1', {
      status: TicketStatus.OPEN,
    });

    const data = prisma.ticket.update.mock.calls[0][0].data;
    expect(data.resolvedAt).toBeNull();
    expect(data.closedAt).toBeNull();
  });

  it('will not edit a ticket that was merged away', async () => {
    prisma.ticket.findFirst.mockResolvedValue(
      ticketRow({ mergedIntoId: 't2' }),
    );

    await expect(
      service.updateTicket(tenantId, 't1', 'u1', { subject: 'x' }),
    ).rejects.toThrow('merged');
  });

  // ── Merge & link ───────────────────────────────

  it('moves comments across on a merge and closes the source', async () => {
    prisma.ticket.findFirst
      .mockResolvedValueOnce(ticketRow({ id: 't1' }))
      .mockResolvedValueOnce(ticketRow({ id: 't2', number: 'T-2026-0002' }));

    await service.merge(tenantId, 't1', 't2', 'u1');

    expect(prisma.ticketComment.updateMany).toHaveBeenCalledWith({
      where: { tenantId, ticketId: 't1' },
      data: { ticketId: 't2' },
    });
    const data = prisma.ticket.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      mergedIntoId: 't2',
      status: TicketStatus.CLOSED,
    });
  });

  it('refuses to merge a ticket into itself', async () => {
    await expect(
      service.merge(tenantId, 't1', 't1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to merge into a ticket that was itself merged', async () => {
    prisma.ticket.findFirst
      .mockResolvedValueOnce(ticketRow({ id: 't1' }))
      .mockResolvedValueOnce(ticketRow({ id: 't2', mergedIntoId: 't3' }));

    await expect(service.merge(tenantId, 't1', 't2', 'u1')).rejects.toThrow(
      'merged elsewhere',
    );
  });

  it('refuses to make a ticket its own child', async () => {
    prisma.ticket.findFirst.mockResolvedValue(ticketRow());

    await expect(service.link(tenantId, 't1', ['t1'], 'u1')).rejects.toThrow(
      'its own child',
    );
  });

  it('refuses to link a child that does not exist', async () => {
    prisma.ticket.findFirst.mockResolvedValue(ticketRow());
    prisma.ticket.findMany.mockResolvedValue([{ id: 't2' }]);

    await expect(
      service.link(tenantId, 't1', ['t2', 'ghost'], 'u1'),
    ).rejects.toThrow('were not found');
  });

  // ── SLA sweep ──────────────────────────────────

  it('escalates a breached medium ticket to high', async () => {
    prisma.ticket.findMany.mockResolvedValue([
      {
        id: 't1',
        tenantId,
        number: 'T-2026-0001',
        priority: TicketPriority.MEDIUM,
      },
    ]);

    await service.sweepSla();

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        firstResponseBreached: true,
        priority: TicketPriority.HIGH,
      },
    });
  });

  it('does not escalate past urgent', async () => {
    prisma.ticket.findMany.mockResolvedValue([
      {
        id: 't1',
        tenantId,
        number: 'T-2026-0001',
        priority: TicketPriority.URGENT,
      },
    ]);

    await service.sweepSla();

    expect(prisma.ticket.update.mock.calls[0][0].data.priority).toBe(
      TicketPriority.URGENT,
    );
  });

  // ── CSAT ───────────────────────────────────────

  it('hides the survey until the ticket is resolved', async () => {
    prisma.ticket.findUnique.mockResolvedValue({
      status: TicketStatus.OPEN,
      csatRating: null,
      tenant: { name: 'Acme' },
    });

    await expect(service.csatView('tok')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('accepts one rating and refuses a second', async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      ticketRow({ status: TicketStatus.RESOLVED, csatRating: null }),
    );

    await service.submitCsat('tok', { rating: 5, comment: 'Fast' });
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { csatRating: 5, csatComment: 'Fast' },
      }),
    );

    prisma.ticket.findUnique.mockResolvedValue(
      ticketRow({ status: TicketStatus.RESOLVED, csatRating: 5 }),
    );
    await expect(service.submitCsat('tok', { rating: 1 })).rejects.toThrow(
      'already been answered',
    );
  });

  it('refuses a rating on a ticket that is still open', async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      ticketRow({ status: TicketStatus.OPEN }),
    );

    await expect(service.submitCsat('tok', { rating: 5 })).rejects.toThrow(
      'not resolved yet',
    );
  });

  // ── Listing & rules ────────────────────────────

  it('hides merged tickets from the queue', async () => {
    await service.listTickets(tenantId, {});

    expect(prisma.ticket.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId,
      mergedIntoId: null,
    });
  });

  it('filters to breached tickets on either target', async () => {
    await service.listTickets(tenantId, { breached: 'true' });

    expect(prisma.ticket.findMany.mock.calls[0][0].where.OR).toEqual([
      { firstResponseBreached: true },
      { resolutionBreached: true },
    ]);
  });

  it('refuses a specific rule with nobody to assign to', () => {
    expect(() =>
      service.createRule(tenantId, { name: 'Nowhere', strategy: 'specific' }),
    ).toThrow(BadRequestException);
  });

  it('scopes ticket lookups to the tenant', async () => {
    prisma.ticket.findFirst.mockResolvedValue(null);
    await expect(service.getTicket(tenantId, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
