import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAssignmentRuleDto,
  RuleConditionsDto,
  UpdateAssignmentRuleDto,
} from './dto/assignment-rule.dto';

@Injectable()
export class RoutingService {
  private readonly logger = new Logger('RoutingService');

  constructor(private readonly prisma: PrismaService) {}

  // ── Rule CRUD ────────────────────────────────

  listRules(tenantId: string) {
    return this.prisma.assignmentRule.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: {
        assignTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  private assertAssignable(dto: { strategy?: string; assignToId?: string }) {
    if ((dto.strategy ?? 'specific') === 'specific' && !dto.assignToId) {
      throw new BadRequestException(
        'A "specific" rule needs an agent to assign to',
      );
    }
  }

  createRule(tenantId: string, dto: CreateAssignmentRuleDto) {
    this.assertAssignable(dto);
    return this.prisma.assignmentRule.create({
      data: {
        tenantId,
        name: dto.name,
        isActive: dto.isActive ?? true,
        priority: dto.priority ?? 0,
        channel: dto.channel,
        conditions: (dto.conditions ?? {}) as unknown as Prisma.InputJsonValue,
        strategy: dto.strategy ?? 'specific',
        assignToId: dto.assignToId,
      },
    });
  }

  async updateRule(tenantId: string, id: string, dto: UpdateAssignmentRuleDto) {
    const existing = await this.prisma.assignmentRule.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Assignment rule not found');
    this.assertAssignable({
      strategy: dto.strategy ?? existing.strategy,
      assignToId: dto.assignToId ?? existing.assignToId ?? undefined,
    });

    return this.prisma.assignmentRule.update({
      where: { id },
      data: {
        name: dto.name,
        isActive: dto.isActive,
        priority: dto.priority,
        channel: dto.channel,
        conditions: dto.conditions
          ? (dto.conditions as unknown as Prisma.InputJsonValue)
          : undefined,
        strategy: dto.strategy,
        assignToId: dto.assignToId,
      },
    });
  }

  async removeRule(tenantId: string, id: string) {
    const existing = await this.prisma.assignmentRule.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Assignment rule not found');
    await this.prisma.assignmentRule.delete({ where: { id } });
    return { success: true };
  }

  // ── Routing ──────────────────────────────────

  private matches(
    conditions: RuleConditionsDto,
    messageBody: string | null,
  ): boolean {
    const keywords = conditions.keywords ?? [];
    if (!keywords.length) return true; // no conditions -> catch-all
    const haystack = (messageBody ?? '').toLowerCase();
    return keywords.some((k) => haystack.includes(k.toLowerCase()));
  }

  /** Next agent in rotation, by who has fewest open conversations. */
  private async roundRobinAgent(tenantId: string): Promise<string | null> {
    const agents = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { not: 'VIEWER' } },
      select: {
        id: true,
        _count: {
          select: { assignedConversations: { where: { status: 'open' } } },
        },
      },
    });
    if (!agents.length) return null;

    return agents.sort(
      (a, b) => a._count.assignedConversations - b._count.assignedConversations,
    )[0].id;
  }

  /**
   * Applies the first matching rule to an unassigned conversation. Returns the
   * agent it was routed to, or null when nothing matched. Never throws - a
   * routing miss must not block an inbound message.
   */
  async autoAssign(
    tenantId: string,
    conversationId: string,
    channel: Channel,
    messageBody: string | null,
  ): Promise<string | null> {
    try {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { assignedToId: true },
      });
      if (!conversation || conversation.assignedToId) return null;

      const rules = await this.prisma.assignmentRule.findMany({
        where: {
          tenantId,
          isActive: true,
          OR: [{ channel }, { channel: null }],
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });

      for (const rule of rules) {
        if (
          !this.matches(
            rule.conditions as unknown as RuleConditionsDto,
            messageBody,
          )
        ) {
          continue;
        }

        const agentId =
          rule.strategy === 'round_robin'
            ? await this.roundRobinAgent(tenantId)
            : rule.assignToId;

        if (!agentId) continue;

        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { assignedToId: agentId },
        });
        this.logger.log(
          `Rule "${rule.name}" routed conversation ${conversationId} to ${agentId}`,
        );
        return agentId;
      }

      return null;
    } catch (err) {
      this.logger.error(
        `Auto-assign failed for ${conversationId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }
  }
}
