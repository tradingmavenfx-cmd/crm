import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Prisma, WorkflowTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../prisma/tenant-context';
import { WORKFLOW_EVENT, WorkflowEvent } from '../workflows/workflow-events';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/developer.dto';

/** Every event a destination can subscribe to. */
export const WEBHOOK_EVENTS = [
  'contact.created',
  'contact.updated',
  'company.created',
  'company.updated',
  'deal.created',
  'deal.updated',
  'deal.stage_changed',
  'task.created',
  'task.updated',
  'ticket.created',
  'ticket.updated',
  'message.received',
  'call.completed',
] as const;

const MAX_ATTEMPTS = 5;
/** A destination that keeps failing is switched off rather than retried for ever. */
const FAILURES_BEFORE_DISABLING = 15;

/** Seconds to wait before attempt n: 30s, 2m, 8m, 32m. */
export function backoffSeconds(attempt: number): number {
  return 30 * Math.pow(4, Math.max(0, attempt - 1));
}

/**
 * Turns an internal event into the name a subscriber knows it by.
 *
 * Reuses what the workflow engine already emits rather than adding a second
 * set of emissions across every module — one place for "something happened",
 * two things listening.
 */
export function eventName(event: WorkflowEvent): string | null {
  const entity = event.entity;
  switch (event.trigger) {
    case WorkflowTrigger.RECORD_CREATED:
      return entity ? `${entity}.created` : null;
    case WorkflowTrigger.RECORD_UPDATED:
      return entity ? `${entity}.updated` : null;
    case WorkflowTrigger.DEAL_STAGE_CHANGED:
      return 'deal.stage_changed';
    case WorkflowTrigger.FIELD_CHANGED:
      // A stage move arrives as a field change on a deal; it has its own name
      // because it is the one people actually subscribe to.
      if (entity === 'deal' && event.changed?.field === 'stageId') {
        return 'deal.stage_changed';
      }
      return entity ? `${entity}.updated` : null;
    case WorkflowTrigger.MESSAGE_RECEIVED:
      return 'message.received';
    case WorkflowTrigger.CALL_COMPLETED:
      return 'call.completed';
    default:
      return null;
  }
}

/**
 * The signature a destination checks.
 *
 * The timestamp is signed along with the body so a captured delivery cannot be
 * replayed later, and the receiver is told to reject anything much older than
 * it should be.
 */
export function signPayload(
  secret: string,
  timestamp: number,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

/** For a receiver written against this codebase, and for the tests. */
export function verifySignature(
  secret: string,
  timestamp: number,
  body: string,
  presented: string,
): boolean {
  const expected = signPayload(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Managing destinations ────────────────────

  list(tenantId: string) {
    return this.prisma.webhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        isActive: true,
        consecutiveFailures: true,
        disabledAt: true,
        disabledReason: true,
        lastDeliveryAt: true,
        createdAt: true,
        _count: { select: { deliveries: true } },
      },
    });
  }

  async create(tenantId: string, dto: CreateWebhookDto) {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;

    const webhook = await this.prisma.webhook.create({
      data: {
        tenantId,
        name: dto.name,
        url: dto.url,
        events: dto.events,
        secret,
      },
    });

    // Shown once. It is kept so deliveries can be signed, but there is no
    // endpoint that gives it back.
    return { id: webhook.id, name: webhook.name, url: webhook.url, secret };
  }

  async update(tenantId: string, id: string, dto: UpdateWebhookDto) {
    const webhook = await this.prisma.webhook.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!webhook) throw new NotFoundException('Webhook not found');

    return this.prisma.webhook.update({
      where: { id },
      data: {
        name: dto.name,
        url: dto.url,
        events: dto.events,
        isActive: dto.isActive,
        // Turning one back on clears the strikes against it, or it would be
        // switched off again by history rather than by behaviour.
        ...(dto.isActive
          ? { consecutiveFailures: 0, disabledAt: null, disabledReason: null }
          : {}),
      },
      select: { id: true, name: true, url: true, events: true, isActive: true },
    });
  }

  async remove(tenantId: string, id: string) {
    const { count } = await this.prisma.webhook.deleteMany({
      where: { id, tenantId },
    });
    if (count === 0) throw new NotFoundException('Webhook not found');
    return { success: true };
  }

  deliveries(tenantId: string, webhookId?: string) {
    return this.prisma.webhookDelivery.findMany({
      where: { tenantId, ...(webhookId ? { webhookId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        responseStatus: true,
        error: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
        webhook: { select: { id: true, name: true } },
      },
    });
  }

  // ── Sending ──────────────────────────────────

  /**
   * Picks up what the rest of the application already announces.
   *
   * Never throws: a webhook is a courtesy to somebody else's system, and it
   * must not be able to fail the operation that triggered it.
   */
  @OnEvent(WORKFLOW_EVENT)
  async onDomainEvent(event: WorkflowEvent) {
    try {
      const name = eventName(event);
      if (!name) return;
      await this.dispatch(event.tenantId, name, {
        entity: event.entity,
        record: event.record,
        changed: event.changed,
      });
    } catch (err) {
      this.logger.error(
        `Webhook dispatch failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Queues one event to every destination that asked for it. */
  async dispatch(
    tenantId: string,
    event: string,
    data: Record<string, unknown>,
  ) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { tenantId, isActive: true, events: { has: event } },
      select: { id: true },
    });
    if (webhooks.length === 0) return { queued: 0 };

    const payload = {
      event,
      occurredAt: new Date().toISOString(),
      data,
    } as unknown as Prisma.InputJsonValue;

    for (const webhook of webhooks) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: { tenantId, webhookId: webhook.id, event, payload },
      });
      // Tried straight away; the sweep is only for what did not get through.
      void this.attempt(delivery.id, tenantId);
    }

    return { queued: webhooks.length };
  }

  /** Queues one event to a single destination, whatever it subscribes to. */
  async dispatchTo(
    tenantId: string,
    webhookId: string,
    event: string,
    data: Record<string, unknown>,
  ) {
    const webhook = await this.prisma.webhook.findFirst({
      where: { id: webhookId, tenantId },
      select: { id: true },
    });
    if (!webhook) throw new NotFoundException('Webhook not found');

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        tenantId,
        webhookId,
        event,
        payload: {
          event,
          occurredAt: new Date().toISOString(),
          data,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.attempt(delivery.id, tenantId);
    return delivery;
  }

  /** One attempt at one delivery. */
  async attempt(deliveryId: string, tenantId: string) {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, tenantId },
      include: { webhook: true },
    });
    if (!delivery || delivery.status === 'delivered') return;

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const attempts = delivery.attempts + 1;

    try {
      const response = await fetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CRM-Event': delivery.event,
          'X-CRM-Delivery': delivery.id,
          'X-CRM-Timestamp': String(timestamp),
          'X-CRM-Signature': `sha256=${signPayload(
            delivery.webhook.secret,
            timestamp,
            body,
          )}`,
        },
        body,
        // A destination that does not answer promptly must not hold a
        // connection open behind the rest of the queue.
        signal: AbortSignal.timeout(10_000),
      });

      const text = (await response.text().catch(() => '')).slice(0, 500);

      if (response.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'delivered',
            attempts,
            responseStatus: response.status,
            responseBody: text,
            deliveredAt: new Date(),
            nextAttemptAt: null,
            error: null,
          },
        });
        await this.prisma.webhook.update({
          where: { id: delivery.webhookId },
          data: { consecutiveFailures: 0, lastDeliveryAt: new Date() },
        });
        return;
      }

      await this.recordFailure(
        delivery.id,
        delivery.webhookId,
        attempts,
        `HTTP ${response.status}`,
        response.status,
        text,
      );
    } catch (err) {
      await this.recordFailure(
        delivery.id,
        delivery.webhookId,
        attempts,
        err instanceof Error ? err.message : 'Request failed',
      );
    }
  }

  private async recordFailure(
    deliveryId: string,
    webhookId: string,
    attempts: number,
    error: string,
    responseStatus?: number,
    responseBody?: string,
  ) {
    const givenUp = attempts >= MAX_ATTEMPTS;

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: givenUp ? 'failed' : 'pending',
        attempts,
        error,
        responseStatus,
        responseBody,
        nextAttemptAt: givenUp
          ? null
          : new Date(Date.now() + backoffSeconds(attempts) * 1000),
      },
    });

    const webhook = await this.prisma.webhook.update({
      where: { id: webhookId },
      data: { consecutiveFailures: { increment: 1 } },
      select: { consecutiveFailures: true, isActive: true },
    });

    if (
      webhook.isActive &&
      webhook.consecutiveFailures >= FAILURES_BEFORE_DISABLING
    ) {
      await this.prisma.webhook.update({
        where: { id: webhookId },
        data: {
          isActive: false,
          disabledAt: new Date(),
          disabledReason: `${webhook.consecutiveFailures} deliveries in a row failed`,
        },
      });
      this.logger.warn(
        `Webhook ${webhookId} switched off after ${webhook.consecutiveFailures} failures`,
      );
    }
  }

  /** Sends a delivery again, whatever happened the first time. */
  async replay(tenantId: string, deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, tenantId },
      select: { id: true, payload: true, event: true, webhookId: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    // A new row rather than a rewritten one: what happened the first time is
    // part of the record.
    const copy = await this.prisma.webhookDelivery.create({
      data: {
        tenantId,
        webhookId: delivery.webhookId,
        event: delivery.event,
        payload: delivery.payload as Prisma.InputJsonValue,
      },
    });
    await this.attempt(copy.id, tenantId);

    return this.prisma.webhookDelivery.findFirst({
      where: { id: copy.id, tenantId },
      select: {
        id: true,
        status: true,
        attempts: true,
        responseStatus: true,
        error: true,
      },
    });
  }

  /** Retries whatever is due, across every workspace. */
  @Cron(CronExpression.EVERY_MINUTE)
  async retryDue() {
    const due = await TenantContext.asSystem('webhook retry sweep', () =>
      this.prisma.webhookDelivery.findMany({
        where: {
          status: 'pending',
          attempts: { gt: 0 },
          nextAttemptAt: { not: null, lte: new Date() },
        },
        select: { id: true, tenantId: true },
        take: 200,
      }),
    );

    for (const delivery of due) {
      // Each retry runs inside its own workspace, like any other work.
      await TenantContext.asTenant(delivery.tenantId, () =>
        this.attempt(delivery.id, delivery.tenantId),
      );
    }

    return { retried: due.length };
  }
}
