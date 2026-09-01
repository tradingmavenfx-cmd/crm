import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ActivityType,
  Prisma,
  Workflow,
  WorkflowRunStatus,
  WorkflowTrigger,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SequencesService } from '../sequences/sequences.service';
import { ConditionNode, evaluateConditions } from './conditions';
import { WORKFLOW_EVENT, WorkflowEvent } from './workflow-events';
import {
  CreateWorkflowDto,
  QueryRunsDto,
  UpdateWorkflowDto,
  WorkflowActionDto,
} from './dto/workflow.dto';
import { WORKFLOW_TEMPLATES } from './templates';

interface StepResult {
  type: string;
  status: 'ok' | 'failed';
  detail?: string;
}

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger('WorkflowsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly whatsapp: WhatsappService,
    private readonly sequences: SequencesService,
  ) {}

  // ── CRUD ─────────────────────────────────────

  listWorkflows(tenantId: string) {
    return this.prisma.workflow.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { runs: true } } },
    });
  }

  async getWorkflow(tenantId: string, id: string) {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, tenantId },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    return workflow;
  }

  createWorkflow(tenantId: string, userId: string, dto: CreateWorkflowDto) {
    return this.prisma.workflow.create({
      data: {
        tenantId,
        createdById: userId,
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive ?? true,
        trigger: dto.trigger,
        triggerEntity: dto.triggerEntity,
        triggerConfig: (dto.triggerConfig ??
          {}) as unknown as Prisma.InputJsonValue,
        conditions: (dto.conditions ?? {}) as unknown as Prisma.InputJsonValue,
        actions: dto.actions as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateWorkflow(tenantId: string, id: string, dto: UpdateWorkflowDto) {
    await this.getWorkflow(tenantId, id);
    return this.prisma.workflow.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive,
        trigger: dto.trigger,
        triggerEntity: dto.triggerEntity,
        triggerConfig: dto.triggerConfig
          ? (dto.triggerConfig as unknown as Prisma.InputJsonValue)
          : undefined,
        conditions: dto.conditions
          ? (dto.conditions as unknown as Prisma.InputJsonValue)
          : undefined,
        actions: dto.actions
          ? (dto.actions as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async removeWorkflow(tenantId: string, id: string) {
    await this.getWorkflow(tenantId, id);
    await this.prisma.workflow.delete({ where: { id } });
    return { success: true };
  }

  // ── Templates ────────────────────────────────

  listTemplates() {
    return WORKFLOW_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      trigger: t.trigger,
      triggerEntity: t.triggerEntity,
      actionCount: t.actions.length,
    }));
  }

  async installTemplate(tenantId: string, userId: string, templateId: string) {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new NotFoundException('Template not found');

    return this.createWorkflow(tenantId, userId, {
      name: template.name,
      description: template.description,
      // Installed inactive so it can be reviewed before it starts firing.
      isActive: false,
      trigger: template.trigger,
      triggerEntity: template.triggerEntity,
      triggerConfig: template.triggerConfig,
      conditions: template.conditions,
      actions: template.actions as WorkflowActionDto[],
    });
  }

  // ── Trigger matching ─────────────────────────

  /** Does this workflow care about this event? */
  private matchesTrigger(workflow: Workflow, event: WorkflowEvent): boolean {
    if (workflow.trigger !== event.trigger) return false;

    const config = workflow.triggerConfig as Record<string, unknown>;

    if (workflow.triggerEntity && workflow.triggerEntity !== event.entity) {
      return false;
    }

    if (workflow.trigger === WorkflowTrigger.FIELD_CHANGED) {
      if (config.field && config.field !== event.changed?.field) return false;
      if (
        config.to !== undefined &&
        String(config.to) !== String(event.changed?.to)
      ) {
        return false;
      }
    }

    if (workflow.trigger === WorkflowTrigger.MESSAGE_RECEIVED) {
      if (config.channel && config.channel !== event.channel) return false;
    }

    if (workflow.trigger === WorkflowTrigger.WEBHOOK) {
      if (config.key !== event.webhookKey) return false;
    }

    return true;
  }

  /**
   * Entry point for every domain event. Runs each matching workflow in turn;
   * one failing workflow never stops the others, and nothing here is allowed to
   * propagate back into the caller that emitted the event.
   */
  @OnEvent(WORKFLOW_EVENT, { async: true })
  async handleEvent(event: WorkflowEvent): Promise<void> {
    try {
      const workflows = await this.prisma.workflow.findMany({
        where: {
          tenantId: event.tenantId,
          isActive: true,
          trigger: event.trigger,
        },
        orderBy: { createdAt: 'asc' },
      });

      for (const workflow of workflows) {
        if (!this.matchesTrigger(workflow, event)) continue;
        await this.run(workflow, event);
      }
    } catch (err) {
      this.logger.error(
        `Workflow dispatch failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ── Execution ────────────────────────────────

  /** Runs one workflow and records the outcome. Never throws. */
  private async run(workflow: Workflow, event: WorkflowEvent): Promise<void> {
    const startedAt = Date.now();
    const record = event.record ?? {};

    const matched = evaluateConditions(
      workflow.conditions as unknown as ConditionNode,
      record,
    );

    if (!matched) {
      await this.recordRun(workflow, event, {
        status: WorkflowRunStatus.SKIPPED,
        steps: [],
        message: 'Conditions not met',
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const actions = (workflow.actions ?? []) as unknown as WorkflowActionDto[];
    const steps: StepResult[] = [];
    let failed = false;

    for (const action of actions) {
      try {
        const detail = await this.execute(workflow.tenantId, action, record);
        steps.push({ type: action.type, status: 'ok', detail });
      } catch (err) {
        failed = true;
        steps.push({
          type: action.type,
          status: 'failed',
          detail: err instanceof Error ? err.message : 'unknown error',
        });
        // Later steps usually depend on earlier ones, so stop at the failure.
        break;
      }
    }

    await this.recordRun(workflow, event, {
      status: failed ? WorkflowRunStatus.FAILED : WorkflowRunStatus.SUCCESS,
      steps,
      message: failed ? steps.find((s) => s.status === 'failed')?.detail : null,
      durationMs: Date.now() - startedAt,
    });
  }

  private async recordRun(
    workflow: Workflow,
    event: WorkflowEvent,
    outcome: {
      status: WorkflowRunStatus;
      steps: StepResult[];
      message?: string | null;
      durationMs: number;
    },
  ) {
    await this.prisma.workflowRun.create({
      data: {
        tenantId: workflow.tenantId,
        workflowId: workflow.id,
        status: outcome.status,
        triggerPayload: {
          trigger: event.trigger,
          entity: event.entity,
          channel: event.channel,
          changed: event.changed,
          recordId: (event.record?.id as string) ?? null,
        } as unknown as Prisma.InputJsonValue,
        steps: outcome.steps as unknown as Prisma.InputJsonValue,
        message: outcome.message ?? undefined,
        durationMs: outcome.durationMs,
      },
    });

    if (outcome.status !== WorkflowRunStatus.SKIPPED) {
      await this.prisma.workflow.update({
        where: { id: workflow.id },
        data: { runCount: { increment: 1 }, lastRunAt: new Date() },
      });
    }
  }

  /** Fills {{field}} placeholders from the triggering record. */
  private render(value: unknown, record: Record<string, unknown>): string {
    return String(value ?? '').replace(
      /\{\{\s*([\w.]+)\s*\}\}/g,
      (match, path: string) => {
        const resolved = path
          .split('.')
          .reduce<unknown>(
            (acc, key) =>
              acc && typeof acc === 'object'
                ? (acc as Record<string, unknown>)[key]
                : undefined,
            record,
          );
        return resolved === undefined || resolved === null
          ? match
          : String(resolved);
      },
    );
  }

  private async execute(
    tenantId: string,
    action: WorkflowActionDto,
    record: Record<string, unknown>,
  ): Promise<string> {
    const config = action.config ?? {};
    const text = (key: string) => this.render(config[key], record);

    switch (action.type) {
      case 'send_email': {
        const to = config.to ? text('to') : (record.email as string);
        if (!to) throw new Error('No email address on the record');
        const message = await this.email.send(tenantId, {
          to,
          subject: text('subject'),
          html: text('body'),
        });
        return `emailed ${to} (${message.id})`;
      }

      case 'send_sms': {
        const to = config.to ? text('to') : (record.phone as string);
        if (!to) throw new Error('No phone number on the record');
        const message = await this.sms.send(tenantId, {
          to,
          text: text('text'),
        });
        return `texted ${to} (${message.id})`;
      }

      case 'send_whatsapp': {
        const to = config.to ? text('to') : (record.phone as string);
        if (!to) throw new Error('No phone number on the record');
        const message = await this.whatsapp.send(tenantId, {
          to,
          templateName: text('templateName'),
          parameters: [String(record.firstName ?? '')],
        });
        return `whatsapp template to ${to} (${message.id})`;
      }

      case 'create_task': {
        const assigneeId =
          (config.assigneeId as string) ??
          (record.ownerId as string) ??
          (await this.anyAgent(tenantId));
        if (!assigneeId) throw new Error('No user available to own the task');

        const dueInHours = Number(config.dueInHours ?? 24);
        const task = await this.prisma.task.create({
          data: {
            tenantId,
            title: text('title'),
            description: config.description ? text('description') : undefined,
            priority: (config.priority as string) ?? 'medium',
            dueAt: new Date(Date.now() + dueInHours * 60 * 60 * 1000),
            assigneeId,
            creatorId: assigneeId,
          },
        });
        return `task "${task.title}"`;
      }

      case 'create_activity': {
        const userId =
          (record.ownerId as string) ?? (await this.anyAgent(tenantId));
        if (!userId) throw new Error('No user available to log the activity');

        await this.prisma.activity.create({
          data: {
            tenantId,
            type: (config.type as ActivityType) ?? ActivityType.NOTE,
            subject: text('subject'),
            body: config.body ? text('body') : undefined,
            userId,
            contactId: (record.contactId as string) ?? (record.id as string),
          },
        });
        return 'activity logged';
      }

      case 'assign_owner': {
        const entityId = record.id as string;
        if (!entityId) throw new Error('No record to assign');

        const ownerId =
          config.strategy === 'round_robin'
            ? await this.leastBusyAgent(tenantId)
            : (config.userId as string);
        if (!ownerId) throw new Error('No agent to assign to');

        // Contacts and deals are the records worth owning here.
        const asContact = await this.prisma.contact.updateMany({
          where: { id: entityId, tenantId },
          data: { ownerId },
        });
        if (!asContact.count) {
          await this.prisma.deal.updateMany({
            where: { id: entityId, tenantId },
            data: { ownerId },
          });
        }
        return `assigned to ${ownerId}`;
      }

      case 'update_field': {
        const entityId = record.id as string;
        const field = String(config.field ?? '');
        if (!entityId || !field) throw new Error('Nothing to update');

        const value = config.value;
        const data = {
          [field]: value,
        } as Prisma.ContactUpdateManyMutationInput;
        const updated = await this.prisma.contact.updateMany({
          where: { id: entityId, tenantId },
          data,
        });
        if (!updated.count) {
          await this.prisma.deal.updateMany({
            where: { id: entityId, tenantId },
            data: data as Prisma.DealUpdateManyMutationInput,
          });
        }
        return `set ${field}`;
      }

      case 'add_to_sequence': {
        const contactId = (record.contactId as string) ?? (record.id as string);
        if (!contactId) throw new Error('No contact to enrol');
        const result = await this.sequences.enroll(
          tenantId,
          String(config.sequenceId),
          [contactId],
        );
        return `enrolled ${result.enrolled}, skipped ${result.skipped}`;
      }

      case 'webhook': {
        const url = text('url');
        const res = await fetch(url, {
          method: String(config.method ?? 'POST'),
          headers: {
            'Content-Type': 'application/json',
            ...((config.headers as Record<string, string>) ?? {}),
          },
          body: JSON.stringify({ record }),
        });
        if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
        return `webhook ${res.status}`;
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async anyAgent(tenantId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return user?.id;
  }

  private async leastBusyAgent(tenantId: string): Promise<string | undefined> {
    const agents = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { not: 'VIEWER' } },
      select: {
        id: true,
        _count: { select: { assignedTasks: { where: { status: 'open' } } } },
      },
    });
    if (!agents.length) return undefined;
    return agents.sort(
      (a, b) => a._count.assignedTasks - b._count.assignedTasks,
    )[0].id;
  }

  // ── Scheduled workflows ──────────────────────

  /**
   * Fires SCHEDULE workflows that are due. Supports { everyMinutes } and
   * { dailyAt: "HH:MM" }; lastRunAt keeps a schedule from double-firing.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduled(): Promise<void> {
    const workflows = await this.prisma.workflow.findMany({
      where: { isActive: true, trigger: WorkflowTrigger.SCHEDULE },
    });

    const now = new Date();
    for (const workflow of workflows) {
      const config = workflow.triggerConfig as Record<string, unknown>;
      if (!this.isDue(workflow.lastRunAt, config, now)) continue;

      await this.run(workflow, {
        tenantId: workflow.tenantId,
        trigger: WorkflowTrigger.SCHEDULE,
        record: { firedAt: now.toISOString() },
      });
    }
  }

  private isDue(
    lastRunAt: Date | null,
    config: Record<string, unknown>,
    now: Date,
  ): boolean {
    if (config.everyMinutes) {
      const minutes = Number(config.everyMinutes);
      if (!minutes) return false;
      if (!lastRunAt) return true;
      return now.getTime() - lastRunAt.getTime() >= minutes * 60 * 1000;
    }

    if (typeof config.dailyAt === 'string') {
      const [hh, mm] = config.dailyAt.split(':').map(Number);
      if (now.getHours() !== hh || now.getMinutes() !== mm) return false;
      // Already fired within this minute?
      return !lastRunAt || now.getTime() - lastRunAt.getTime() >= 60 * 1000;
    }

    return false;
  }

  // ── History & analytics ──────────────────────

  listRuns(tenantId: string, workflowId: string, query: QueryRunsDto) {
    return this.prisma.workflowRun.findMany({
      where: {
        tenantId,
        workflowId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Execution volume, success rate and the slowest workflows. */
  async analytics(tenantId: string) {
    const [byStatus, aggregate, byWorkflow, workflows] = await Promise.all([
      this.prisma.workflowRun.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.workflowRun.aggregate({
        where: { tenantId },
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
      this.prisma.workflowRun.groupBy({
        by: ['workflowId'],
        where: { tenantId },
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
      this.prisma.workflow.findMany({
        where: { tenantId },
        select: { id: true, name: true, isActive: true },
      }),
    ]);

    const counts = Object.fromEntries(
      byStatus.map((r) => [r.status, r._count._all]),
    ) as Record<string, number>;

    const total = aggregate._count._all;
    const success = counts[WorkflowRunStatus.SUCCESS] ?? 0;
    const failed = counts[WorkflowRunStatus.FAILED] ?? 0;

    return {
      totalRuns: total,
      success,
      failed,
      skipped: counts[WorkflowRunStatus.SKIPPED] ?? 0,
      // Skipped runs are a correct outcome, so the rate is over runs that acted.
      successRate:
        success + failed ? Math.round((success / (success + failed)) * 100) : 0,
      avgDurationMs: Math.round(aggregate._avg.durationMs ?? 0),
      activeWorkflows: workflows.filter((w) => w.isActive).length,
      byWorkflow: byWorkflow
        .map((row) => ({
          workflowId: row.workflowId,
          name:
            workflows.find((w) => w.id === row.workflowId)?.name ?? 'Deleted',
          runs: row._count._all,
          avgDurationMs: Math.round(row._avg.durationMs ?? 0),
        }))
        .sort((a, b) => b.runs - a.runs),
    };
  }

  /** Dry run: evaluates conditions against a record without doing anything. */
  async test(tenantId: string, id: string, record: Record<string, unknown>) {
    const workflow = await this.getWorkflow(tenantId, id);
    const matched = evaluateConditions(
      workflow.conditions as unknown as ConditionNode,
      record,
    );
    const actions = (workflow.actions ?? []) as unknown as WorkflowActionDto[];

    return {
      matched,
      wouldRun: matched
        ? actions.map((a) => ({
            type: a.type,
            preview: Object.fromEntries(
              Object.entries(a.config ?? {}).map(([k, v]) => [
                k,
                typeof v === 'string' ? this.render(v, record) : v,
              ]),
            ),
          }))
        : [],
    };
  }
}
