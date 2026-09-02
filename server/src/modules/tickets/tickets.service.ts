import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import {
  Channel,
  Prisma,
  TicketPriority,
  TicketStatus,
  WorkflowTrigger,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxService } from '../inbox/inbox.service';
import { WORKFLOW_EVENT } from '../workflows/workflow-events';
import {
  CreateSlaPolicyDto,
  CreateTicketDto,
  CreateTicketRuleDto,
  CsatDto,
  QueryTicketsDto,
  TicketCommentDto,
  UpdateTicketDto,
} from './dto/ticket.dto';

/** Targets used when a tenant has configured no SLA policy. */
const DEFAULT_SLA = {
  firstResponseMinutes: { LOW: 480, MEDIUM: 240, HIGH: 60, URGENT: 30 },
  resolutionMinutes: { LOW: 5760, MEDIUM: 2880, HIGH: 480, URGENT: 240 },
};

const OPEN_STATUSES: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.PENDING,
  TicketStatus.ON_HOLD,
];

@Injectable()
export class TicketsService {
  private readonly logger = new Logger('TicketsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Helpers ──────────────────────────────────

  private async nextNumber(tenantId: string): Promise<string> {
    const stem = `T-${new Date().getFullYear()}-`;
    const last = await this.prisma.ticket.findFirst({
      where: { tenantId, number: { startsWith: stem } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const next = last ? Number(last.number.slice(stem.length)) + 1 : 1;
    return `${stem}${String(next).padStart(4, '0')}`;
  }

  private log(
    tenantId: string,
    ticketId: string,
    type: string,
    detail: Record<string, unknown> = {},
    userId?: string,
  ) {
    return this.prisma.ticketEvent.create({
      data: {
        tenantId,
        ticketId,
        type,
        detail: detail as unknown as Prisma.InputJsonValue,
        userId,
      },
    });
  }

  /** The SLA clocks for a priority, from the named policy or the default. */
  private async slaDueDates(
    tenantId: string,
    priority: TicketPriority,
    slaPolicyId?: string | null,
  ) {
    const policy = slaPolicyId
      ? await this.prisma.slaPolicy.findFirst({
          where: { id: slaPolicyId, tenantId, isActive: true },
        })
      : await this.prisma.slaPolicy.findFirst({
          where: { tenantId, isActive: true, isDefault: true },
        });

    const first =
      (policy?.firstResponseMinutes as Record<string, number>) ??
      DEFAULT_SLA.firstResponseMinutes;
    const resolve =
      (policy?.resolutionMinutes as Record<string, number>) ??
      DEFAULT_SLA.resolutionMinutes;

    const minute = 60 * 1000;
    const now = Date.now();

    return {
      slaPolicyId: policy?.id ?? null,
      firstResponseDueAt: new Date(
        now + (first[priority] ?? first.MEDIUM ?? 240) * minute,
      ),
      resolutionDueAt: new Date(
        now + (resolve[priority] ?? resolve.MEDIUM ?? 2880) * minute,
      ),
    };
  }

  /**
   * Applies the first matching rule: category, priority and owner. Never
   * throws - a routing miss must not stop a ticket being raised.
   */
  private async applyRules(
    tenantId: string,
    input: { subject: string; description?: string; channel?: Channel | null },
  ): Promise<{
    category?: string;
    priority?: TicketPriority;
    assigneeId?: string;
  }> {
    try {
      const rules = await this.prisma.ticketRule.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });

      const haystack =
        `${input.subject} ${input.description ?? ''}`.toLowerCase();

      for (const rule of rules) {
        const conditions = rule.conditions as {
          keywords?: string[];
          channel?: Channel;
        };

        if (conditions.channel && conditions.channel !== input.channel)
          continue;

        const keywords = conditions.keywords ?? [];
        const matches =
          keywords.length === 0 ||
          keywords.some((k) => haystack.includes(k.toLowerCase()));
        if (!matches) continue;

        const assigneeId =
          rule.strategy === 'specific'
            ? (rule.assignToId ?? undefined)
            : ((await this.pickAgent(tenantId, rule.strategy)) ?? undefined);

        return {
          category: rule.setCategory ?? undefined,
          priority: rule.setPriority ?? undefined,
          assigneeId,
        };
      }
    } catch (err) {
      this.logger.error(
        `Ticket routing failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    return {};
  }

  /** Round robin and load based both mean "fewest open tickets" here. */
  private async pickAgent(
    tenantId: string,
    _strategy: string,
  ): Promise<string | null> {
    const agents = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { not: 'VIEWER' } },
      select: {
        id: true,
        _count: {
          select: {
            assignedTickets: { where: { status: { in: OPEN_STATUSES } } },
          },
        },
      },
    });
    if (!agents.length) return null;
    return agents.sort(
      (a, b) => a._count.assignedTickets - b._count.assignedTickets,
    )[0].id;
  }

  // ── CRUD ─────────────────────────────────────

  listTickets(tenantId: string, query: QueryTicketsDto) {
    const where: Prisma.TicketWhereInput = { tenantId, mergedIntoId: null };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.category) where.category = query.category;
    if (query.breached === 'true') {
      where.OR = [
        { firstResponseBreached: true },
        { resolutionBreached: true },
      ];
    }
    if (query.search) {
      where.AND = [
        {
          OR: [
            { subject: { contains: query.search, mode: 'insensitive' } },
            { number: { contains: query.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    return this.prisma.ticket.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        assignee: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { comments: true, children: true } },
      },
    });
  }

  async getTicket(tenantId: string, id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, tenantId },
      include: {
        requester: true,
        assignee: { select: { id: true, firstName: true, lastName: true } },
        slaPolicy: { select: { id: true, name: true } },
        comments: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'desc' }, take: 50 },
        children: {
          select: { id: true, number: true, subject: true, status: true },
        },
        parent: { select: { id: true, number: true, subject: true } },
        mergedInto: { select: { id: true, number: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async createTicket(tenantId: string, userId: string, dto: CreateTicketDto) {
    // Rules fill the gaps; anything the caller set explicitly wins.
    const routed = await this.applyRules(tenantId, {
      subject: dto.subject,
      description: dto.description,
      channel: dto.channel,
    });

    const priority = dto.priority ?? routed.priority ?? TicketPriority.MEDIUM;
    const sla = await this.slaDueDates(tenantId, priority, dto.slaPolicyId);

    const ticket = await this.prisma.ticket.create({
      data: {
        tenantId,
        number: await this.nextNumber(tenantId),
        subject: dto.subject,
        description: dto.description,
        priority,
        category: dto.category ?? routed.category,
        tags: dto.tags ?? [],
        channel: dto.channel,
        requesterId: dto.requesterId,
        assigneeId: dto.assigneeId ?? routed.assigneeId,
        conversationId: dto.conversationId,
        parentId: dto.parentId,
        csatToken: randomBytes(18).toString('base64url'),
        ...sla,
      },
    });

    await this.log(
      tenantId,
      ticket.id,
      'created',
      {
        routedCategory: routed.category ?? null,
        routedAssignee: routed.assigneeId ?? null,
      },
      userId,
    );

    this.events.emit(WORKFLOW_EVENT, {
      tenantId,
      trigger: WorkflowTrigger.RECORD_CREATED,
      entity: 'ticket',
      record: ticket as unknown as Record<string, unknown>,
    });

    return ticket;
  }

  /**
   * Raises a ticket from an inbox thread, carrying over the channel, the
   * contact and the first inbound message as the description.
   */
  async fromConversation(
    tenantId: string,
    userId: string,
    conversationId: string,
    overrides: Partial<CreateTicketDto> = {},
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        contact: true,
        messages: {
          where: { isInternal: false, direction: 'INBOUND' },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const existing = await this.prisma.ticket.findFirst({
      where: { tenantId, conversationId, mergedIntoId: null },
      select: { id: true, number: true },
    });
    if (existing) {
      throw new BadRequestException(
        `This conversation is already ticket ${existing.number}`,
      );
    }

    const first = conversation.messages[0];
    const subject =
      overrides.subject ??
      (first?.body
        ? first.body.slice(0, 80)
        : `Enquiry on ${conversation.channel}`);

    return this.createTicket(tenantId, userId, {
      subject,
      description: overrides.description ?? first?.body ?? undefined,
      channel: conversation.channel,
      requesterId: conversation.contactId ?? undefined,
      conversationId,
      ...overrides,
    });
  }

  async updateTicket(
    tenantId: string,
    id: string,
    userId: string,
    dto: UpdateTicketDto,
  ) {
    const ticket = await this.getTicket(tenantId, id);
    if (ticket.mergedIntoId) {
      throw new BadRequestException(
        'This ticket was merged and is no longer worked on',
      );
    }

    // A priority change resets the SLA clocks against the new target.
    const sla =
      dto.priority && dto.priority !== ticket.priority
        ? await this.slaDueDates(tenantId, dto.priority, ticket.slaPolicyId)
        : null;

    const closing =
      dto.status === TicketStatus.RESOLVED ||
      dto.status === TicketStatus.CLOSED;

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        subject: dto.subject,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        category: dto.category,
        tags: dto.tags,
        assigneeId:
          dto.assigneeId === '' ? null : (dto.assigneeId ?? undefined),
        ...(sla ?? {}),
        resolvedAt:
          dto.status === TicketStatus.RESOLVED && !ticket.resolvedAt
            ? new Date()
            : undefined,
        closedAt:
          dto.status === TicketStatus.CLOSED && !ticket.closedAt
            ? new Date()
            : undefined,
        // Reopening clears the resolution stamps so the clock is honest.
        ...(dto.status && OPEN_STATUSES.includes(dto.status)
          ? { resolvedAt: null, closedAt: null }
          : {}),
      },
    });

    if (dto.status && dto.status !== ticket.status) {
      await this.log(
        tenantId,
        id,
        'status',
        { from: ticket.status, to: dto.status },
        userId,
      );
    }
    if (dto.priority && dto.priority !== ticket.priority) {
      await this.log(
        tenantId,
        id,
        'priority',
        { from: ticket.priority, to: dto.priority },
        userId,
      );
    }
    if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
      await this.log(
        tenantId,
        id,
        'assigned',
        { to: dto.assigneeId || null },
        userId,
      );
    }
    if (closing) {
      this.events.emit(WORKFLOW_EVENT, {
        tenantId,
        trigger: WorkflowTrigger.FIELD_CHANGED,
        entity: 'ticket',
        record: updated as unknown as Record<string, unknown>,
        changed: { field: 'status', from: ticket.status, to: dto.status },
      });
    }

    return updated;
  }

  async removeTicket(tenantId: string, id: string) {
    await this.getTicket(tenantId, id);
    await this.prisma.ticket.delete({ where: { id } });
    return { success: true };
  }

  // ── Comments ─────────────────────────────────

  /**
   * A public reply stops the first-response clock. When the ticket came from a
   * conversation, the reply is also sent on that channel, so the customer sees
   * it where they wrote.
   */
  async addComment(
    tenantId: string,
    id: string,
    userId: string,
    dto: TicketCommentDto,
  ) {
    const ticket = await this.getTicket(tenantId, id);
    const isInternal = dto.isInternal ?? false;

    let deliveredOn: Channel | null = null;
    if (!isInternal && ticket.conversationId) {
      try {
        await this.inbox.reply(tenantId, ticket.conversationId, {
          text: dto.body,
        });
        deliveredOn = ticket.channel;
      } catch (err) {
        // A voice thread has no text leg; the comment is still recorded.
        this.logger.warn(
          `Reply not delivered for ${ticket.number}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    const comment = await this.prisma.ticketComment.create({
      data: {
        tenantId,
        ticketId: id,
        authorId: userId,
        body: dto.body,
        isInternal,
        channel: deliveredOn,
      },
    });

    if (!isInternal && !ticket.firstRespondedAt) {
      await this.prisma.ticket.update({
        where: { id },
        data: { firstRespondedAt: new Date() },
      });
    }

    return { ...comment, deliveredOn };
  }

  // ── Merge & link ─────────────────────────────

  /**
   * Folds one ticket into another: comments move across, and the source stops
   * being worked. Nothing is deleted, so the history stays auditable.
   */
  async merge(
    tenantId: string,
    id: string,
    intoTicketId: string,
    userId: string,
  ) {
    if (id === intoTicketId) {
      throw new BadRequestException('A ticket cannot be merged into itself');
    }
    const source = await this.getTicket(tenantId, id);
    const target = await this.getTicket(tenantId, intoTicketId);

    if (source.mergedIntoId) {
      throw new BadRequestException('This ticket has already been merged');
    }
    if (target.mergedIntoId) {
      throw new BadRequestException(
        'The target ticket has itself been merged elsewhere',
      );
    }

    await this.prisma.ticketComment.updateMany({
      where: { tenantId, ticketId: id },
      data: { ticketId: intoTicketId },
    });

    const merged = await this.prisma.ticket.update({
      where: { id },
      data: {
        mergedIntoId: intoTicketId,
        status: TicketStatus.CLOSED,
        closedAt: new Date(),
      },
    });

    await this.log(tenantId, id, 'merged', { into: target.number }, userId);
    await this.log(
      tenantId,
      intoTicketId,
      'merged',
      { from: source.number },
      userId,
    );

    return merged;
  }

  /** Makes tickets children of this one. */
  async link(tenantId: string, id: string, childIds: string[], userId: string) {
    await this.getTicket(tenantId, id);
    if (childIds.includes(id)) {
      throw new BadRequestException('A ticket cannot be its own child');
    }

    const children = await this.prisma.ticket.findMany({
      where: { tenantId, id: { in: childIds } },
      select: { id: true },
    });
    if (children.length !== childIds.length) {
      throw new BadRequestException('One or more child tickets were not found');
    }

    await this.prisma.ticket.updateMany({
      where: { tenantId, id: { in: childIds } },
      data: { parentId: id },
    });
    await this.log(tenantId, id, 'linked', { children: childIds }, userId);

    return { success: true, linked: childIds.length };
  }

  // ── CSAT ─────────────────────────────────────

  /** The survey, addressed only by its token. */
  async csatView(token: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { csatToken: token },
      select: {
        number: true,
        subject: true,
        status: true,
        csatRating: true,
        tenant: { select: { name: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Survey not found');

    const closed =
      ticket.status === TicketStatus.RESOLVED ||
      ticket.status === TicketStatus.CLOSED;
    if (!closed) throw new NotFoundException('Survey not found');

    return { ...ticket, alreadyRated: ticket.csatRating !== null };
  }

  async submitCsat(token: string, dto: CsatDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { csatToken: token },
    });
    if (!ticket) throw new NotFoundException('Survey not found');

    const closed =
      ticket.status === TicketStatus.RESOLVED ||
      ticket.status === TicketStatus.CLOSED;
    if (!closed) {
      throw new BadRequestException('This ticket is not resolved yet');
    }
    if (ticket.csatRating !== null) {
      throw new BadRequestException('This survey has already been answered');
    }

    const rated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { csatRating: dto.rating, csatComment: dto.comment },
      select: { number: true, csatRating: true },
    });
    await this.log(ticket.tenantId, ticket.id, 'csat', { rating: dto.rating });

    return rated;
  }

  // ── SLA sweep ────────────────────────────────

  /**
   * Flags tickets that have missed a target and escalates their priority once.
   * Runs every five minutes rather than on a timer per ticket.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepSla(): Promise<void> {
    const now = new Date();

    const firstResponse = await this.prisma.ticket.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        firstRespondedAt: null,
        firstResponseBreached: false,
        firstResponseDueAt: { not: null, lt: now },
      },
      select: { id: true, tenantId: true, number: true, priority: true },
    });

    for (const ticket of firstResponse) {
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          firstResponseBreached: true,
          // One escalation step, so a breach is visible in the queue order.
          priority:
            ticket.priority === TicketPriority.URGENT
              ? TicketPriority.URGENT
              : ticket.priority === TicketPriority.HIGH
                ? TicketPriority.URGENT
                : ticket.priority === TicketPriority.MEDIUM
                  ? TicketPriority.HIGH
                  : TicketPriority.MEDIUM,
        },
      });
      await this.log(ticket.tenantId, ticket.id, 'sla_breach', {
        target: 'first_response',
      });
    }

    const resolution = await this.prisma.ticket.updateMany({
      where: {
        status: { in: OPEN_STATUSES },
        resolvedAt: null,
        resolutionBreached: false,
        resolutionDueAt: { not: null, lt: now },
      },
      data: { resolutionBreached: true },
    });

    if (firstResponse.length || resolution.count) {
      this.logger.log(
        `SLA sweep: ${firstResponse.length} first-response, ${resolution.count} resolution breach(es)`,
      );
    }
  }

  // ── Stats ────────────────────────────────────

  async stats(tenantId: string) {
    const [byStatus, byPriority, tickets] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: { tenantId, mergedIntoId: null },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['priority'],
        where: { tenantId, mergedIntoId: null, status: { in: OPEN_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.ticket.findMany({
        where: { tenantId, mergedIntoId: null },
        select: {
          createdAt: true,
          resolvedAt: true,
          firstResponseBreached: true,
          resolutionBreached: true,
          csatRating: true,
        },
      }),
    ]);

    const resolved = tickets.filter((t) => t.resolvedAt);
    const hours = resolved.map(
      (t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3600000,
    );
    const rated = tickets.filter((t) => t.csatRating !== null);
    const breached = tickets.filter(
      (t) => t.firstResponseBreached || t.resolutionBreached,
    ).length;

    return {
      total: tickets.length,
      byStatus: Object.fromEntries(
        byStatus.map((r) => [r.status, r._count._all]),
      ),
      openByPriority: Object.fromEntries(
        byPriority.map((r) => [r.priority, r._count._all]),
      ),
      breached,
      slaCompliance: tickets.length
        ? Math.round(((tickets.length - breached) / tickets.length) * 100)
        : 100,
      avgResolutionHours: hours.length
        ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) /
          10
        : 0,
      csatResponses: rated.length,
      csatAverage: rated.length
        ? Math.round(
            (rated.reduce((sum, t) => sum + (t.csatRating ?? 0), 0) /
              rated.length) *
              10,
          ) / 10
        : 0,
    };
  }

  // ── SLA policies & rules ─────────────────────

  listPolicies(tenantId: string) {
    return this.prisma.slaPolicy.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createPolicy(tenantId: string, dto: CreateSlaPolicyDto) {
    if (dto.isDefault) {
      await this.prisma.slaPolicy.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.prisma.slaPolicy.create({
      data: {
        tenantId,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        firstResponseMinutes:
          dto.firstResponseMinutes as unknown as Prisma.InputJsonValue,
        resolutionMinutes:
          dto.resolutionMinutes as unknown as Prisma.InputJsonValue,
      },
    });
  }

  listRules(tenantId: string) {
    return this.prisma.ticketRule.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: {
        assignTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  createRule(tenantId: string, dto: CreateTicketRuleDto) {
    if ((dto.strategy ?? 'specific') === 'specific' && !dto.assignToId) {
      // A rule that assigns to nobody would silently do nothing.
      throw new BadRequestException(
        'A "specific" rule needs an agent, or pick a round_robin strategy',
      );
    }
    return this.prisma.ticketRule.create({
      data: {
        tenantId,
        name: dto.name,
        isActive: dto.isActive ?? true,
        priority: dto.priority ?? 0,
        conditions: (dto.conditions ?? {}) as unknown as Prisma.InputJsonValue,
        setCategory: dto.setCategory,
        setPriority: dto.setPriority,
        strategy: dto.strategy ?? 'specific',
        assignToId: dto.assignToId,
      },
    });
  }

  async removeRule(tenantId: string, id: string) {
    const rule = await this.prisma.ticketRule.findFirst({
      where: { id, tenantId },
    });
    if (!rule) throw new NotFoundException('Ticket rule not found');
    await this.prisma.ticketRule.delete({ where: { id } });
    return { success: true };
  }
}
