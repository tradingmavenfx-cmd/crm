import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash, randomBytes } from 'crypto';
import {
  Channel,
  InvoiceStatus,
  Prisma,
  QuoteStatus,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from '../email/providers/email-provider.interface';
import { TicketsService } from '../tickets/tickets.service';
import { TICKET_REPLY_EVENT, TicketReplyEvent } from '../tickets/ticket-events';
import {
  PortalCommentDto,
  PortalTicketDto,
  RequestLinkDto,
} from './dto/portal.dto';

/** Who the session belongs to. Every portal query is scoped by both. */
export interface PortalContext {
  tenantId: string;
  contactId: string;
}

const LINK_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 14;
/** A second link inside this window reuses nothing — it is simply not sent. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Quote states a customer is meant to see. The rest are internal workings. */
const CUSTOMER_QUOTE_STATUSES: QuoteStatus[] = [
  QuoteStatus.SENT,
  QuoteStatus.ACCEPTED,
  QuoteStatus.DECLINED,
  QuoteStatus.EXPIRED,
];

const REOPEN_FROM: TicketStatus[] = [
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
];

@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tickets: TicketsService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  // ── Tokens ───────────────────────────────────

  /**
   * Tokens are stored as hashes, never in the clear: a dump of the portal
   * tables must not be replayable as a login.
   */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private issue(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  }

  // ── Signing in ───────────────────────────────

  /**
   * Emails a one-time link to a known contact.
   *
   * The answer is the same whether or not the address belongs to anyone, so
   * the portal cannot be used to find out who a company's customers are.
   */
  async requestLink(tenantId: string, dto: RequestLinkDto) {
    const answer = {
      sent: true,
      message: 'If that address is on file, a sign-in link is on its way.',
    };

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!tenant) return answer;

    const contact = await this.prisma.contact.findFirst({
      where: {
        tenantId,
        email: { equals: dto.email.trim(), mode: 'insensitive' },
      },
      select: { id: true, email: true, firstName: true },
    });
    if (!contact?.email) return answer;

    // Someone hammering the form should not fill the customer's inbox.
    const recent = await this.prisma.portalLoginToken.findFirst({
      where: {
        tenantId,
        contactId: contact.id,
        createdAt: {
          gte: new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000),
        },
      },
      select: { id: true },
    });
    if (recent) return answer;

    const { token, tokenHash } = this.issue();
    await this.prisma.portalLoginToken.create({
      data: {
        tenantId,
        contactId: contact.id,
        tokenHash,
        expiresAt: new Date(Date.now() + LINK_TTL_MINUTES * 60 * 1000),
      },
    });

    const base = this.config.get<string>('corsOrigin') ?? '';
    const link = `${base}/portal/${tenantId}/enter?token=${token}`;

    // Sent straight through the provider rather than through EmailService: a
    // sign-in link is not a conversation, and has no business appearing in an
    // agent's inbox or carrying a tracking pixel.
    try {
      await this.email.send({
        to: contact.email,
        subject: `Your ${tenant.name} sign-in link`,
        text: [
          `Hello ${contact.firstName},`,
          '',
          `Open your ${tenant.name} account here:`,
          link,
          '',
          `The link works once and expires in ${LINK_TTL_MINUTES} minutes.`,
          'If you did not ask for it, you can ignore this email.',
        ].join('\n'),
      });
    } catch (err) {
      // The caller is told nothing either way, so a mail failure is logged
      // rather than surfaced.
      this.logger.error(
        `Portal link not sent: ${err instanceof Error ? err.message : err}`,
      );
    }

    return answer;
  }

  /** Exchanges a link for a session. The link dies in the process. */
  async startSession(tenantId: string, token: string) {
    const row = await this.prisma.portalLoginToken.findUnique({
      where: { tokenHash: this.hash(token) },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    // One message for every failure: expired, spent, wrong workspace or never
    // existed all look the same from outside.
    const invalid = () =>
      new UnauthorizedException('That link is no longer valid');

    if (!row || row.tenantId !== tenantId) throw invalid();
    if (row.consumedAt) throw invalid();
    if (row.expiresAt < new Date()) throw invalid();

    await this.prisma.portalLoginToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    const { token: sessionToken, tokenHash } = this.issue();
    await this.prisma.portalSession.create({
      data: {
        tenantId,
        contactId: row.contactId,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000),
      },
    });

    return {
      sessionToken,
      contact: {
        firstName: row.contact.firstName,
        lastName: row.contact.lastName,
        email: row.contact.email,
      },
    };
  }

  /** Resolves a session token to the contact it belongs to. */
  async authenticate(token: string | undefined): Promise<PortalContext> {
    if (!token) throw new UnauthorizedException('Not signed in');

    const session = await this.prisma.portalSession.findUnique({
      where: { tokenHash: this.hash(token) },
      select: {
        id: true,
        tenantId: true,
        contactId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    await this.prisma.portalSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return { tenantId: session.tenantId, contactId: session.contactId };
  }

  async endSession(token: string) {
    await this.prisma.portalSession.updateMany({
      where: { tokenHash: this.hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  // ── What the customer sees ───────────────────

  async me(ctx: PortalContext) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: ctx.contactId, tenantId: ctx.tenantId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        company: { select: { name: true } },
        tenant: { select: { name: true } },
      },
    });
    if (!contact) throw new NotFoundException('Account not found');

    return {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      company: contact.company?.name ?? null,
      tenant: contact.tenant.name,
    };
  }

  listTickets(ctx: PortalContext) {
    return this.prisma.ticket.findMany({
      // Scoped by contact as well as tenant: the session is the only thing
      // that decides whose tickets these are.
      where: {
        tenantId: ctx.tenantId,
        requesterId: ctx.contactId,
        mergedIntoId: null,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        number: true,
        subject: true,
        status: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
      },
    });
  }

  async getTicket(ctx: PortalContext, id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, tenantId: ctx.tenantId, requesterId: ctx.contactId },
      select: {
        id: true,
        number: true,
        subject: true,
        description: true,
        status: true,
        category: true,
        createdAt: true,
        resolvedAt: true,
        csatRating: true,
        assignee: { select: { firstName: true } },
        comments: {
          // Internal notes are how agents talk to each other. They never
          // cross into the portal.
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            body: true,
            createdAt: true,
            authorId: true,
            author: { select: { firstName: true } },
          },
        },
      },
    });
    // Someone else's ticket is indistinguishable from one that never existed.
    if (!ticket) throw new NotFoundException('Ticket not found');

    return {
      ...ticket,
      comments: ticket.comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        // A comment with no agent author is the customer's own reply.
        from: c.authorId ? (c.author?.firstName ?? 'Support') : 'You',
        mine: !c.authorId,
      })),
    };
  }

  /**
   * Raises a ticket as the signed-in contact.
   *
   * Priority, assignee and category are not accepted from the customer —
   * those are the routing rules' job, and a customer marking everything
   * urgent would make the queue meaningless.
   */
  async createTicket(ctx: PortalContext, dto: PortalTicketDto) {
    const ticket = await this.tickets.createTicket(ctx.tenantId, '', {
      subject: dto.subject,
      description: dto.description,
      channel: Channel.EMAIL,
      requesterId: ctx.contactId,
      priority: TicketPriority.MEDIUM,
    });

    return { id: ticket.id, number: ticket.number };
  }

  /**
   * A reply from the customer.
   *
   * Deliberately not TicketsService.addComment: that stamps the first-response
   * clock, and a customer answering themselves must never mark the team's SLA
   * as met.
   */
  async replyToTicket(ctx: PortalContext, id: string, dto: PortalCommentDto) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, tenantId: ctx.tenantId, requesterId: ctx.contactId },
      select: { id: true, status: true, mergedIntoId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.mergedIntoId) {
      throw new BadRequestException(
        'This ticket was merged into another one and is no longer worked on',
      );
    }

    const comment = await this.prisma.ticketComment.create({
      data: {
        tenantId: ctx.tenantId,
        ticketId: id,
        // No authorId: the requester wrote it, not an agent.
        authorId: null,
        body: dto.body,
        isInternal: false,
        channel: Channel.EMAIL,
      },
    });

    // Answering a resolved ticket brings it back, rather than disappearing
    // into a closed thread nobody reads.
    if (REOPEN_FROM.includes(ticket.status)) {
      await this.prisma.ticket.update({
        where: { id },
        data: { status: TicketStatus.OPEN, resolvedAt: null, closedAt: null },
      });
      await this.prisma.ticketEvent.create({
        data: {
          tenantId: ctx.tenantId,
          ticketId: id,
          type: 'reopened',
          detail: {
            by: 'customer',
            from: ticket.status,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return { id: comment.id, createdAt: comment.createdAt };
  }

  /**
   * Tells a customer there is an answer waiting.
   *
   * A ticket raised in the portal has no channel thread to reply on, so
   * without this the reply would sit there until the customer thought to look.
   * Skipped when the reply already reached them over their own channel.
   */
  @OnEvent(TICKET_REPLY_EVENT)
  async notifyOfReply(event: TicketReplyEvent) {
    if (event.delivered) return;

    const ticket = await this.prisma.ticket.findFirst({
      where: { id: event.ticketId, tenantId: event.tenantId },
      select: {
        number: true,
        subject: true,
        requester: { select: { firstName: true, email: true } },
        tenant: { select: { name: true } },
      },
    });
    if (!ticket?.requester?.email) return;

    const base = this.config.get<string>('corsOrigin') ?? '';
    try {
      await this.email.send({
        to: ticket.requester.email,
        subject: `Re: ${ticket.subject} (${ticket.number})`,
        text: [
          `Hello ${ticket.requester.firstName},`,
          '',
          `There is a reply on your request ${ticket.number}.`,
          // The reply itself is not repeated here: the portal is where it
          // lives, and it can only be read by whoever holds the mailbox.
          `${base}/portal/${event.tenantId}`,
          '',
          `${ticket.tenant.name} support`,
        ].join('\n'),
      });
    } catch (err) {
      this.logger.error(
        `Reply notice not sent for ${ticket.number}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** Quotes sent to this contact, and what they came to. */
  async listQuotes(ctx: PortalContext) {
    const quotes = await this.prisma.quote.findMany({
      where: {
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
        status: { in: CUSTOMER_QUOTE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        number: true,
        status: true,
        currency: true,
        total: true,
        validUntil: true,
        sentAt: true,
        acceptedAt: true,
        publicToken: true,
      },
    });

    return quotes.map((q) => ({
      number: q.number,
      status: q.status,
      currency: q.currency,
      total: q.total,
      validUntil: q.validUntil,
      sentAt: q.sentAt,
      acceptedAt: q.acceptedAt,
      // The path to the existing customer-facing quote page, so the portal
      // does not become a second place that renders prices.
      path: `/q/${q.publicToken}`,
    }));
  }

  /** Invoices raised against this contact's accepted quotes. */
  listInvoices(ctx: PortalContext) {
    return this.prisma.invoice.findMany({
      where: {
        tenantId: ctx.tenantId,
        quote: { contactId: ctx.contactId },
        // A draft invoice has not been raised with the customer yet.
        status: { not: InvoiceStatus.DRAFT },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        number: true,
        status: true,
        currency: true,
        total: true,
        dueAt: true,
        issuedAt: true,
        paidAt: true,
      },
    });
  }
}
