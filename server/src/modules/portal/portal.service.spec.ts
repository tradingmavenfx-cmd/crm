import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { QuoteStatus, TicketStatus } from '@prisma/client';
import { PortalService } from './portal.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { EMAIL_PROVIDER } from '../email/providers/email-provider.interface';

const tenantId = 'tenant-1';
const contactId = 'contact-1';
const ctx = { tenantId, contactId };

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

const loginToken = (over: Record<string, unknown> = {}) => ({
  id: 'lt1',
  tenantId,
  contactId,
  tokenHash: 'hash',
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null,
  contact: {
    id: contactId,
    firstName: 'Riya',
    lastName: 'Sharma',
    email: 'riya@example.com',
  },
  ...over,
});

describe('PortalService', () => {
  let service: PortalService;
  let prisma: any;
  let email: { send: jest.Mock };
  let tickets: { createTicket: jest.Mock; addComment: jest.Mock };

  beforeEach(async () => {
    prisma = {
      tenant: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenantId, name: 'Acme Corp' }),
      },
      contact: {
        findFirst: jest.fn().mockResolvedValue({
          id: contactId,
          email: 'riya@example.com',
          firstName: 'Riya',
        }),
      },
      portalLoginToken: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      portalSession: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      ticket: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      ticketComment: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'c1', createdAt: new Date() }),
      },
      ticketEvent: { create: jest.fn().mockResolvedValue({}) },
      quote: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
    };
    email = { send: jest.fn().mockResolvedValue({ externalId: 'm1' }) };
    tickets = {
      createTicket: jest
        .fn()
        .mockResolvedValue({ id: 't1', number: 'T-2026-0001' }),
      addComment: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PortalService,
        { provide: PrismaService, useValue: prisma },
        { provide: TicketsService, useValue: tickets },
        { provide: EMAIL_PROVIDER, useValue: email },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:3000' },
        },
      ],
    }).compile();

    service = moduleRef.get(PortalService);
  });

  // ── Requesting a link ──────────────────────────

  it('emails a one-time link to a contact on file', async () => {
    await service.requestLink(tenantId, { email: 'riya@example.com' });

    expect(email.send).toHaveBeenCalledTimes(1);
    const sent = email.send.mock.calls[0][0];
    expect(sent.to).toBe('riya@example.com');
    expect(sent.text).toContain(`/portal/${tenantId}/enter?token=`);
  });

  it('answers an unknown address exactly as it answers a known one', async () => {
    const known = await service.requestLink(tenantId, {
      email: 'riya@example.com',
    });

    prisma.contact.findFirst.mockResolvedValue(null);
    const unknown = await service.requestLink(tenantId, {
      email: 'nobody@example.com',
    });

    // Otherwise the portal is a way of asking who a company's customers are.
    expect(unknown).toEqual(known);
    expect(prisma.portalLoginToken.create).toHaveBeenCalledTimes(1);
  });

  it('says the same thing for a workspace that does not exist', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);

    const result = await service.requestLink('nope', {
      email: 'riya@example.com',
    });

    expect(result.sent).toBe(true);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('stores the link hashed, never in the clear', async () => {
    await service.requestLink(tenantId, { email: 'riya@example.com' });

    const stored = prisma.portalLoginToken.create.mock.calls[0][0].data;
    const link = email.send.mock.calls[0][0].text as string;
    const token = /token=([\w-]+)/.exec(link)![1];

    expect(stored.tokenHash).toBe(sha(token));
    expect(stored.tokenHash).not.toBe(token);
  });

  it('does not send a second link within the cooldown', async () => {
    prisma.portalLoginToken.findFirst.mockResolvedValue({ id: 'lt0' });

    await service.requestLink(tenantId, { email: 'riya@example.com' });

    expect(email.send).not.toHaveBeenCalled();
  });

  it('a mail failure is not reported back to whoever asked', async () => {
    email.send.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.requestLink(tenantId, { email: 'riya@example.com' }),
    ).resolves.toMatchObject({ sent: true });
  });

  // ── Starting a session ─────────────────────────

  it('exchanges a link for a session and spends the link', async () => {
    prisma.portalLoginToken.findUnique.mockResolvedValue(loginToken());

    const result = await service.startSession(tenantId, 'raw-token');

    expect(result.sessionToken).toEqual(expect.any(String));
    expect(
      prisma.portalLoginToken.update.mock.calls[0][0].data.consumedAt,
    ).toBeInstanceOf(Date);
    expect(prisma.portalSession.create.mock.calls[0][0].data.tokenHash).toBe(
      sha(result.sessionToken),
    );
  });

  it('refuses a link that was already used', async () => {
    prisma.portalLoginToken.findUnique.mockResolvedValue(
      loginToken({ consumedAt: new Date() }),
    );

    await expect(service.startSession(tenantId, 'raw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses an expired link', async () => {
    prisma.portalLoginToken.findUnique.mockResolvedValue(
      loginToken({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.startSession(tenantId, 'raw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('a link from one workspace cannot open a session in another', async () => {
    prisma.portalLoginToken.findUnique.mockResolvedValue(
      loginToken({ tenantId: 'tenant-2' }),
    );

    await expect(service.startSession(tenantId, 'raw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.portalSession.create).not.toHaveBeenCalled();
  });

  it('every rejection reads the same, so a link cannot be probed', async () => {
    const reasons = [
      null,
      loginToken({ consumedAt: new Date() }),
      loginToken({ expiresAt: new Date(0) }),
      loginToken({ tenantId: 'other' }),
    ];

    const messages: string[] = [];
    for (const row of reasons) {
      prisma.portalLoginToken.findUnique.mockResolvedValue(row);
      await service.startSession(tenantId, 'raw').catch((e) => {
        messages.push(e.message);
      });
    }

    expect(new Set(messages).size).toBe(1);
  });

  // ── Sessions ───────────────────────────────────

  it('resolves a live session to its contact', async () => {
    prisma.portalSession.findUnique.mockResolvedValue({
      id: 's1',
      tenantId,
      contactId,
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: null,
    });

    await expect(service.authenticate('tok')).resolves.toEqual(ctx);
  });

  it('refuses a revoked or expired session, and one with no token at all', async () => {
    prisma.portalSession.findUnique.mockResolvedValue({
      id: 's1',
      tenantId,
      contactId,
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
    });
    await expect(service.authenticate('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    prisma.portalSession.findUnique.mockResolvedValue({
      id: 's1',
      tenantId,
      contactId,
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
    });
    await expect(service.authenticate('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    await expect(service.authenticate(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('signing out revokes the session it was made with', async () => {
    await service.endSession('tok');

    expect(prisma.portalSession.updateMany.mock.calls[0][0].where).toEqual({
      tokenHash: sha('tok'),
      revokedAt: null,
    });
  });

  // ── Seeing only your own ───────────────────────

  it('lists only the signed-in contact tickets', async () => {
    await service.listTickets(ctx);

    expect(prisma.ticket.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId,
      requesterId: contactId,
    });
  });

  it('someone else ticket is indistinguishable from one that never existed', async () => {
    prisma.ticket.findFirst.mockResolvedValue(null);

    await expect(service.getTicket(ctx, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('never returns internal notes', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      id: 't1',
      number: 'T-2026-0001',
      subject: 'Refund',
      status: TicketStatus.OPEN,
      comments: [],
    });

    await service.getTicket(ctx, 't1');

    expect(
      prisma.ticket.findFirst.mock.calls[0][0].select.comments.where,
    ).toEqual({ isInternal: false });
  });

  it('marks which replies are the customer own', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      id: 't1',
      number: 'T-2026-0001',
      comments: [
        {
          id: 'c1',
          body: 'Any news?',
          createdAt: new Date(),
          authorId: null,
          author: null,
        },
        {
          id: 'c2',
          body: 'Looking into it.',
          createdAt: new Date(),
          authorId: 'u1',
          author: { firstName: 'Ravi' },
        },
      ],
    });

    const view = await service.getTicket(ctx, 't1');

    expect(view.comments[0]).toMatchObject({ from: 'You', mine: true });
    expect(view.comments[1]).toMatchObject({ from: 'Ravi', mine: false });
  });

  // ── Raising and replying ───────────────────────

  it('raises the ticket as the signed-in contact, not as whoever asked', async () => {
    await service.createTicket(ctx, {
      subject: 'Refund not received',
      description: 'It has been ten days.',
    });

    const dto = tickets.createTicket.mock.calls[0][2];
    expect(dto.requesterId).toBe(contactId);
    // Priority and assignee are the routing rules' job; a customer marking
    // everything urgent would make the queue meaningless.
    expect(dto.assigneeId).toBeUndefined();
    expect(dto.priority).toBe('MEDIUM');
  });

  it('a customer reply does not stop the first-response clock', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      id: 't1',
      status: TicketStatus.OPEN,
      mergedIntoId: null,
    });

    await service.replyToTicket(ctx, 't1', { body: 'Any news?' });

    // The agent SLA must not be satisfied by the customer answering themselves.
    expect(tickets.addComment).not.toHaveBeenCalled();
    expect(prisma.ticketComment.create.mock.calls[0][0].data).toMatchObject({
      authorId: null,
      isInternal: false,
    });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('replying to a resolved ticket reopens it', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      id: 't1',
      status: TicketStatus.RESOLVED,
      mergedIntoId: null,
    });

    await service.replyToTicket(ctx, 't1', { body: 'Still broken' });

    expect(prisma.ticket.update.mock.calls[0][0].data).toMatchObject({
      status: TicketStatus.OPEN,
      resolvedAt: null,
      closedAt: null,
    });
    expect(prisma.ticketEvent.create.mock.calls[0][0].data.type).toBe(
      'reopened',
    );
  });

  it('cannot reply to a ticket that was merged away', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      id: 't1',
      status: TicketStatus.OPEN,
      mergedIntoId: 't2',
    });

    await expect(
      service.replyToTicket(ctx, 't1', { body: 'hello' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cannot reply to a ticket belonging to someone else', async () => {
    prisma.ticket.findFirst.mockResolvedValue(null);

    await expect(
      service.replyToTicket(ctx, 'other', { body: 'hello' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ticketComment.create).not.toHaveBeenCalled();
  });

  // ── Telling the customer there is an answer ────

  it('emails the requester when a reply had nowhere else to go', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      number: 'T-2026-0003',
      subject: 'Wrong GSTIN',
      requester: { firstName: 'Priya', email: 'priya@globex.in' },
      tenant: { name: 'Acme Corp' },
    });

    await service.notifyOfReply({ tenantId, ticketId: 't1', delivered: false });

    const sent = email.send.mock.calls[0][0];
    expect(sent.to).toBe('priya@globex.in');
    expect(sent.text).toContain(`/portal/${tenantId}`);
  });

  it('says nothing when the reply already reached them on their channel', async () => {
    await service.notifyOfReply({ tenantId, ticketId: 't1', delivered: true });

    expect(email.send).not.toHaveBeenCalled();
  });

  it('a requester with no email is simply skipped', async () => {
    prisma.ticket.findFirst.mockResolvedValue({
      number: 'T-2026-0003',
      subject: 'Wrong GSTIN',
      requester: { firstName: 'Priya', email: null },
      tenant: { name: 'Acme Corp' },
    });

    await expect(
      service.notifyOfReply({ tenantId, ticketId: 't1', delivered: false }),
    ).resolves.toBeUndefined();
    expect(email.send).not.toHaveBeenCalled();
  });

  // ── Money ──────────────────────────────────────

  it('shows only quotes that were actually sent to the customer', async () => {
    await service.listQuotes(ctx);

    const where = prisma.quote.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId, contactId });
    expect(where.status.in).not.toContain(QuoteStatus.DRAFT);
    expect(where.status.in).not.toContain(QuoteStatus.PENDING_APPROVAL);
    expect(where.status.in).toContain(QuoteStatus.SENT);
  });

  it('links a quote to the page that already renders it', async () => {
    prisma.quote.findMany.mockResolvedValue([
      {
        number: 'Q-2026-0001',
        status: QuoteStatus.SENT,
        currency: 'INR',
        total: '1000',
        validUntil: null,
        sentAt: new Date(),
        acceptedAt: null,
        publicToken: 'tok-123',
      },
    ]);

    const [quote] = await service.listQuotes(ctx);

    expect(quote.path).toBe('/q/tok-123');
    // The token addresses the page; it is not something to hand back as data.
    expect(quote).not.toHaveProperty('publicToken');
  });

  it('does not show a draft invoice', async () => {
    await service.listInvoices(ctx);

    expect(prisma.invoice.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId,
      quote: { contactId },
      status: { not: 'DRAFT' },
    });
  });
});
