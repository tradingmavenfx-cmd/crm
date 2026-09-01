import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActivityType,
  CallDirection,
  CallStatus,
  Channel,
  Contact,
  MessageDirection,
  MessageStatus,
  Prisma,
  WorkflowTrigger,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { WORKFLOW_EVENT } from '../workflows/workflow-events';
import {
  IvrAction,
  PlaceCallInput,
  VOICE_PROVIDER,
  VoiceProvider,
} from './providers/voice-provider.interface';
import { ClickToCallDto, QueryCallsDto } from './dto/call.dto';
import {
  CreateIvrFlowDto,
  IvrOptionDto,
  UpdateIvrFlowDto,
} from './dto/ivr-flow.dto';

export interface IncomingCallDto {
  from: string;
  to?: string;
  externalId: string;
}

export interface DtmfDto {
  externalId: string;
  digits: string;
}

export interface CallStatusDto {
  externalId: string;
  status: string;
  durationSec?: number;
  recordingUrl?: string;
}

export interface RecordingDto {
  externalId: string;
  recordingUrl: string;
  transcript?: string;
  durationSec?: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class VoiceService {
  private readonly logger = new Logger('VoiceService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly events: EventEmitter2,
    @Inject(VOICE_PROVIDER) private readonly provider: VoiceProvider,
  ) {}

  // ── Helpers ──────────────────────────────────

  private normalize(phone: string): string {
    return phone.replace(/[\s()-]/g, '');
  }

  /** Absolute URL the telephony platform posts the next IVR step back to. */
  private webhookUrl(tenantId: string, path: string): string {
    const base = (this.config.get<string>('voice.publicUrl') ?? '').replace(
      /\/$/,
      '',
    );
    return `${base}/voice/webhook/${tenantId}/${path}`;
  }

  private async findContactByPhone(tenantId: string, phone: string) {
    const normalized = this.normalize(phone);
    const candidates = await this.prisma.contact.findMany({
      where: { tenantId, phone: { not: null } },
    });
    return (
      candidates.find((c) => this.normalize(c.phone!) === normalized) ?? null
    );
  }

  /** Calls are threaded into the unified inbox alongside chat channels. */
  private async getOrCreateConversation(
    tenantId: string,
    phone: string,
    contactId?: string | null,
  ) {
    const externalId = this.normalize(phone);
    const existing = await this.prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalId: {
          tenantId,
          channel: Channel.VOICE,
          externalId,
        },
      },
    });
    if (existing) {
      // The thread may pre-date the contact (first call from an unknown
      // number); adopt the contact once one is known.
      if (!existing.contactId && contactId) {
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { contactId },
        });
      }
      return existing;
    }

    return this.prisma.conversation.create({
      data: { tenantId, channel: Channel.VOICE, externalId, contactId },
    });
  }

  private parseOptions(raw: Prisma.JsonValue | null): IvrOptionDto[] {
    return Array.isArray(raw) ? (raw as unknown as IvrOptionDto[]) : [];
  }

  private async getCallByExternalId(tenantId: string, externalId: string) {
    const call = await this.prisma.call.findFirst({
      where: { tenantId, externalId },
    });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  /** Greeting + keypad prompt for a flow. */
  private menuAction(
    tenantId: string,
    flow: { greeting: string; options: Prisma.JsonValue },
    prefix?: string,
  ): IvrAction {
    const options = this.parseOptions(flow.options);
    const menu = options
      .map((o) => `For ${o.label}, press ${o.digit}.`)
      .join(' ');
    return {
      say: [prefix, flow.greeting, menu].filter(Boolean).join(' '),
      gather: {
        numDigits: 1,
        actionUrl: this.webhookUrl(tenantId, 'dtmf'),
        timeoutSec: 8,
      },
    };
  }

  private voicemailAction(tenantId: string, say: string): IvrAction {
    return {
      say,
      record: {
        maxLengthSec: this.config.get<number>('voice.voicemailMaxSec') ?? 120,
        actionUrl: this.webhookUrl(tenantId, 'recording'),
      },
    };
  }

  /** Renders an action through the active provider (TwiML or mock JSON). */
  render(action: IvrAction) {
    return this.provider.renderIvr(action);
  }

  // ── Inbound calls & IVR ──────────────────────

  /**
   * Answers an inbound call: logs it, threads it into the inbox, and returns
   * the first IVR step. VIP callers skip the menu and go straight to their
   * account manager.
   */
  async handleIncoming(
    tenantId: string,
    dto: IncomingCallDto,
  ): Promise<IvrAction> {
    const contact = await this.findContactByPhone(tenantId, dto.from);
    const conversation = await this.getOrCreateConversation(
      tenantId,
      dto.from,
      contact?.id,
    );

    const call = await this.prisma.call.create({
      data: {
        tenantId,
        direction: CallDirection.INBOUND,
        from: this.normalize(dto.from),
        to: dto.to ? this.normalize(dto.to) : '',
        status: CallStatus.RINGING,
        externalId: dto.externalId,
        contactId: contact?.id,
        conversationId: conversation.id,
      },
    });

    // Priority routing: a high-scoring contact with an owner bypasses the menu.
    const vipThreshold =
      this.config.get<number>('voice.vipScoreThreshold') ?? 70;
    if (contact && contact.score >= vipThreshold && contact.ownerId) {
      const owner = await this.prisma.user.findFirst({
        where: { id: contact.ownerId, tenantId, isActive: true },
      });
      if (owner?.phone) {
        await this.prisma.call.update({
          where: { id: call.id },
          data: {
            agentId: owner.id,
            ivrPath: ['vip'],
            status: CallStatus.IN_PROGRESS,
          },
        });
        return {
          say: `Welcome back ${contact.firstName}. Connecting you to your account manager.`,
          dial: { number: owner.phone, timeoutSec: 25 },
        };
      }
    }

    const flow = await this.prisma.ivrFlow.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!flow) {
      // No IVR configured - take a voicemail rather than dropping the call.
      await this.prisma.call.update({
        where: { id: call.id },
        data: { status: CallStatus.VOICEMAIL },
      });
      return this.voicemailAction(
        tenantId,
        'Thanks for calling. Please leave a message after the tone.',
      );
    }

    await this.prisma.call.update({
      where: { id: call.id },
      data: { ivrFlowId: flow.id },
    });

    return this.menuAction(tenantId, flow);
  }

  /** Handles one keypress and returns the next IVR step. */
  async handleDtmf(tenantId: string, dto: DtmfDto): Promise<IvrAction> {
    const call = await this.getCallByExternalId(tenantId, dto.externalId);

    const flow = call.ivrFlowId
      ? await this.prisma.ivrFlow.findFirst({
          where: { id: call.ivrFlowId, tenantId },
        })
      : null;

    if (!flow) {
      return this.voicemailAction(
        tenantId,
        'Sorry, this menu is no longer available. Please leave a message.',
      );
    }

    const digit = (dto.digits ?? '').trim().slice(-1);
    const option = this.parseOptions(flow.options).find(
      (o) => o.digit === digit,
    );

    if (!option) {
      return this.menuAction(
        tenantId,
        flow,
        'Sorry, that is not a valid option.',
      );
    }

    await this.prisma.call.update({
      where: { id: call.id },
      data: { ivrPath: { push: digit } },
    });

    switch (option.action) {
      case 'menu':
        return this.descendIntoMenu(tenantId, call.id, option.value);

      case 'transfer':
        return this.transfer(tenantId, call.id, option.value);

      case 'voicemail':
        await this.prisma.call.update({
          where: { id: call.id },
          data: { status: CallStatus.VOICEMAIL },
        });
        return this.voicemailAction(
          tenantId,
          'Please leave a message after the tone.',
        );

      case 'message':
        return { say: option.value ?? 'Thank you for calling.', hangup: true };

      case 'crm_lookup':
        return this.crmLookup(tenantId, call.contactId, option.value);

      case 'hangup':
      default:
        return { say: 'Thank you for calling. Goodbye.', hangup: true };
    }
  }

  private async descendIntoMenu(
    tenantId: string,
    callId: string,
    flowId?: string,
  ): Promise<IvrAction> {
    const target = flowId
      ? await this.prisma.ivrFlow.findFirst({ where: { id: flowId, tenantId } })
      : null;

    if (!target) {
      return this.voicemailAction(
        tenantId,
        'That option is unavailable right now. Please leave a message.',
      );
    }

    await this.prisma.call.update({
      where: { id: callId },
      data: { ivrFlowId: target.id },
    });
    return this.menuAction(tenantId, target);
  }

  /** Transfers to an agent (by user id) or to a raw number. */
  private async transfer(
    tenantId: string,
    callId: string,
    value?: string,
  ): Promise<IvrAction> {
    if (!value) {
      return this.voicemailAction(
        tenantId,
        'No agent is available. Please leave a message.',
      );
    }

    if (UUID_RE.test(value)) {
      const agent = await this.prisma.user.findFirst({
        where: { id: value, tenantId, isActive: true },
      });
      if (!agent?.phone) {
        return this.voicemailAction(
          tenantId,
          'That agent is unavailable. Please leave a message after the tone.',
        );
      }
      await this.prisma.call.update({
        where: { id: callId },
        data: { agentId: agent.id, status: CallStatus.IN_PROGRESS },
      });
      return {
        say: `Connecting you to ${agent.firstName}.`,
        dial: { number: agent.phone, timeoutSec: 25 },
      };
    }

    await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.IN_PROGRESS },
    });
    return {
      say: 'Connecting your call.',
      dial: { number: value, timeoutSec: 25 },
    };
  }

  /**
   * Dynamic IVR: reads back live CRM data for the caller, e.g. "Press 1 for
   * your order status" pulling their most recent deal.
   */
  private async crmLookup(
    tenantId: string,
    contactId: string | null,
    what?: string,
  ): Promise<IvrAction> {
    if (!contactId) {
      return {
        say: 'We could not find your details from this number. Please hold for an agent.',
        hangup: true,
      };
    }

    if (what === 'task') {
      const task = await this.prisma.task.findFirst({
        where: { tenantId, status: { not: 'done' } },
        orderBy: { dueAt: 'asc' },
      });
      return {
        say: task
          ? `Your next scheduled item is: ${task.title}.`
          : 'You have no open items with us right now.',
        hangup: true,
      };
    }

    const deal = await this.prisma.deal.findFirst({
      where: { tenantId, contactId },
      orderBy: { createdAt: 'desc' },
      include: { stage: true },
    });

    return {
      say: deal
        ? `Your order ${deal.title} is currently at the ${deal.stage.name} stage, ` +
          `valued at ${deal.value} ${deal.currency}.`
        : 'We could not find an active order on your account.',
      hangup: true,
    };
  }

  // ── Call lifecycle ───────────────────────────

  private mapStatus(raw: string): CallStatus | null {
    const map: Record<string, CallStatus> = {
      queued: CallStatus.QUEUED,
      initiated: CallStatus.QUEUED,
      ringing: CallStatus.RINGING,
      'in-progress': CallStatus.IN_PROGRESS,
      in_progress: CallStatus.IN_PROGRESS,
      answered: CallStatus.IN_PROGRESS,
      completed: CallStatus.COMPLETED,
      busy: CallStatus.BUSY,
      'no-answer': CallStatus.MISSED,
      no_answer: CallStatus.MISSED,
      missed: CallStatus.MISSED,
      failed: CallStatus.FAILED,
      canceled: CallStatus.MISSED,
      voicemail: CallStatus.VOICEMAIL,
    };
    return map[raw?.toLowerCase()] ?? null;
  }

  /** End-of-call callback: finalises the log and fires missed-call automation. */
  async handleStatus(tenantId: string, dto: CallStatusDto) {
    const call = await this.getCallByExternalId(tenantId, dto.externalId);
    const status = this.mapStatus(dto.status);
    if (!status)
      throw new BadRequestException(`Unknown call status: ${dto.status}`);

    const answered =
      status === CallStatus.COMPLETED || status === CallStatus.IN_PROGRESS;

    const updated = await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status,
        durationSec: dto.durationSec ?? call.durationSec,
        recordingUrl: dto.recordingUrl ?? call.recordingUrl,
        answeredAt: call.answeredAt ?? (answered ? new Date() : null),
        endedAt: new Date(),
      },
    });

    await this.logCallToInbox(updated);

    const missed =
      status === CallStatus.MISSED ||
      status === CallStatus.BUSY ||
      status === CallStatus.FAILED;
    if (missed && updated.direction === CallDirection.INBOUND) {
      await this.runMissedCallAutomation(updated);
    }

    this.events.emit(WORKFLOW_EVENT, {
      tenantId,
      trigger: WorkflowTrigger.CALL_COMPLETED,
      record: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  /** Voicemail recording callback. */
  async handleRecording(tenantId: string, dto: RecordingDto) {
    const call = await this.getCallByExternalId(tenantId, dto.externalId);

    const updated = await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status: CallStatus.VOICEMAIL,
        recordingUrl: dto.recordingUrl,
        transcript: dto.transcript,
        durationSec: dto.durationSec ?? call.durationSec,
        endedAt: new Date(),
      },
    });

    if (updated.conversationId) {
      await this.prisma.message.create({
        data: {
          tenantId,
          conversationId: updated.conversationId,
          channel: Channel.VOICE,
          direction: MessageDirection.INBOUND,
          type: 'voicemail',
          body: dto.transcript
            ? `Voicemail: "${dto.transcript}"`
            : 'Voicemail received',
          status: MessageStatus.RECEIVED,
          metadata: {
            callId: updated.id,
            recordingUrl: dto.recordingUrl,
            durationSec: updated.durationSec,
          },
        },
      });
      await this.prisma.conversation.update({
        where: { id: updated.conversationId },
        data: { lastMessageAt: new Date(), status: 'open' },
      });
    }

    return updated;
  }

  /** Writes a call-log entry into the conversation thread. */
  private async logCallToInbox(call: {
    id: string;
    tenantId: string;
    conversationId: string | null;
    direction: CallDirection;
    status: CallStatus;
    durationSec: number;
    recordingUrl: string | null;
    ivrPath: string[];
    from: string;
  }) {
    if (!call.conversationId) return;

    const label =
      call.direction === CallDirection.INBOUND ? 'Inbound' : 'Outbound';
    const mins = Math.floor(call.durationSec / 60);
    const secs = call.durationSec % 60;
    const duration = call.durationSec ? ` · ${mins}m ${secs}s` : '';

    await this.prisma.message.create({
      data: {
        tenantId: call.tenantId,
        conversationId: call.conversationId,
        channel: Channel.VOICE,
        direction:
          call.direction === CallDirection.INBOUND
            ? MessageDirection.INBOUND
            : MessageDirection.OUTBOUND,
        type: 'call',
        body: `${label} call · ${call.status.toLowerCase()}${duration}`,
        status:
          call.direction === CallDirection.INBOUND
            ? MessageStatus.RECEIVED
            : MessageStatus.SENT,
        metadata: {
          callId: call.id,
          status: call.status,
          durationSec: call.durationSec,
          recordingUrl: call.recordingUrl,
          ivrPath: call.ivrPath,
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: call.conversationId },
      data: { lastMessageAt: new Date() },
    });
  }

  /**
   * Missed inbound call: make sure the caller exists as a lead, put a callback
   * task on an agent, and text them a callback promise. Never throws - a
   * failure here must not break the provider's status callback.
   */
  private async runMissedCallAutomation(call: {
    id: string;
    tenantId: string;
    from: string;
    contactId: string | null;
    agentId: string | null;
    conversationId: string | null;
  }) {
    try {
      const tenantId = call.tenantId;
      let contact: Contact | null = call.contactId
        ? await this.prisma.contact.findFirst({
            where: { id: call.contactId, tenantId },
          })
        : null;

      if (!contact) {
        const last4 = call.from.slice(-4);
        contact = await this.prisma.contact.create({
          data: {
            tenantId,
            firstName: 'Inbound',
            lastName: `Caller ${last4}`,
            phone: call.from,
          },
        });
        await this.prisma.call.update({
          where: { id: call.id },
          data: { contactId: contact.id },
        });
        // The thread was opened before the lead existed - link it up too.
        if (call.conversationId) {
          await this.prisma.conversation.update({
            where: { id: call.conversationId },
            data: { contactId: contact.id },
          });
        }
      }

      // Assign to the handling agent, else the contact owner, else any admin.
      const agentId =
        call.agentId ??
        contact.ownerId ??
        (
          await this.prisma.user.findFirst({
            where: { tenantId, isActive: true },
            orderBy: { createdAt: 'asc' },
          })
        )?.id;

      if (agentId) {
        await this.prisma.task.create({
          data: {
            tenantId,
            title: `Call back ${call.from}`,
            description: 'Auto-created from a missed inbound call.',
            dueAt: new Date(Date.now() + 60 * 60 * 1000),
            priority: 'high',
            assigneeId: agentId,
            creatorId: agentId,
          },
        });

        await this.prisma.activity.create({
          data: {
            tenantId,
            type: ActivityType.CALL,
            subject: `Missed call from ${call.from}`,
            userId: agentId,
            contactId: contact.id,
          },
        });
      }

      const followUp = this.config.get<string>('voice.missedCallSms');
      if (followUp) {
        await this.sms
          .send(tenantId, { to: call.from, text: followUp })
          .catch((err: Error) =>
            this.logger.warn(`Missed-call SMS skipped: ${err.message}`),
          );
      }
    } catch (err) {
      this.logger.error(
        `Missed-call automation failed for call ${call.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // ── Outbound (click-to-call) ─────────────────

  async clickToCall(tenantId: string, userId: string, dto: ClickToCallDto) {
    const agent = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    const agentNumber = dto.agentNumber ?? agent?.phone;
    if (!agentNumber) {
      throw new BadRequestException(
        'No agent number - set a phone on your user profile or pass agentNumber',
      );
    }

    const contact = dto.contactId
      ? await this.prisma.contact.findFirst({
          where: { id: dto.contactId, tenantId },
        })
      : await this.findContactByPhone(tenantId, dto.to);

    const conversation = await this.getOrCreateConversation(
      tenantId,
      dto.to,
      contact?.id,
    );

    const input: PlaceCallInput = { to: dto.to, agentNumber };
    const result = await this.provider.placeCall(input);

    return this.prisma.call.create({
      data: {
        tenantId,
        direction: CallDirection.OUTBOUND,
        from: this.normalize(agentNumber),
        to: this.normalize(dto.to),
        status: CallStatus.QUEUED,
        externalId: result.externalId,
        contactId: contact?.id,
        agentId: userId,
        conversationId: conversation.id,
      },
    });
  }

  // ── Call log & analytics ─────────────────────

  async listCalls(tenantId: string, query: QueryCallsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CallWhereInput = { tenantId };
    if (query.direction) where.direction = query.direction;
    if (query.status) where.status = query.status;
    if (query.contactId) where.contactId = query.contactId;
    if (query.agentId) where.agentId = query.agentId;

    const [data, total] = await Promise.all([
      this.prisma.call.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          agent: { select: { id: true, firstName: true, lastName: true } },
          ivrFlow: { select: { id: true, name: true } },
        },
      }),
      this.prisma.call.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getCall(tenantId: string, id: string) {
    const call = await this.prisma.call.findFirst({
      where: { id, tenantId },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        agent: { select: { id: true, firstName: true, lastName: true } },
        ivrFlow: { select: { id: true, name: true } },
      },
    });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  /** Volume, answer rate, talk time - overall and per agent. */
  async analytics(tenantId: string) {
    const [byStatus, byDirection, aggregate, byAgent] = await Promise.all([
      this.prisma.call.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.call.groupBy({
        by: ['direction'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.call.aggregate({
        where: { tenantId },
        _count: { _all: true },
        _sum: { durationSec: true },
        _avg: { durationSec: true },
      }),
      this.prisma.call.groupBy({
        by: ['agentId'],
        where: { tenantId, agentId: { not: null } },
        _count: { _all: true },
        _sum: { durationSec: true },
      }),
    ]);

    const counts = Object.fromEntries(
      byStatus.map((s) => [s.status, s._count._all]),
    ) as Record<string, number>;

    const total = aggregate._count._all;
    const answered =
      (counts[CallStatus.COMPLETED] ?? 0) +
      (counts[CallStatus.IN_PROGRESS] ?? 0);
    const missed =
      (counts[CallStatus.MISSED] ?? 0) +
      (counts[CallStatus.BUSY] ?? 0) +
      (counts[CallStatus.FAILED] ?? 0);

    const agents = await this.prisma.user.findMany({
      where: { tenantId, id: { in: byAgent.map((a) => a.agentId!) } },
      select: { id: true, firstName: true, lastName: true },
    });

    return {
      total,
      answered,
      missed,
      voicemails: counts[CallStatus.VOICEMAIL] ?? 0,
      answerRate: total ? Math.round((answered / total) * 100) : 0,
      totalTalkTimeSec: aggregate._sum.durationSec ?? 0,
      avgDurationSec: Math.round(aggregate._avg.durationSec ?? 0),
      byStatus: counts,
      byDirection: Object.fromEntries(
        byDirection.map((d) => [d.direction, d._count._all]),
      ),
      byAgent: byAgent.map((a) => {
        const agent = agents.find((u) => u.id === a.agentId);
        return {
          agentId: a.agentId,
          name: agent ? `${agent.firstName} ${agent.lastName}` : 'Unknown',
          calls: a._count._all,
          talkTimeSec: a._sum.durationSec ?? 0,
        };
      }),
    };
  }

  // ── IVR flow management ──────────────────────

  listFlows(tenantId: string) {
    return this.prisma.ivrFlow.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async getFlow(tenantId: string, id: string) {
    const flow = await this.prisma.ivrFlow.findFirst({
      where: { id, tenantId },
    });
    if (!flow) throw new NotFoundException('IVR flow not found');
    return flow;
  }

  async createFlow(tenantId: string, dto: CreateIvrFlowDto) {
    this.assertUniqueDigits(dto.options);
    if (dto.isActive) await this.deactivateOthers(tenantId);

    return this.prisma.ivrFlow.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        greeting: dto.greeting,
        isActive: dto.isActive ?? false,
        options: dto.options as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateFlow(tenantId: string, id: string, dto: UpdateIvrFlowDto) {
    await this.getFlow(tenantId, id);
    if (dto.options) this.assertUniqueDigits(dto.options);
    if (dto.isActive) await this.deactivateOthers(tenantId, id);

    return this.prisma.ivrFlow.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        greeting: dto.greeting,
        isActive: dto.isActive,
        options: dto.options
          ? (dto.options as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async removeFlow(tenantId: string, id: string) {
    await this.getFlow(tenantId, id);
    // Keep call history readable - detach rather than cascade-delete the logs.
    await this.prisma.call.updateMany({
      where: { tenantId, ivrFlowId: id },
      data: { ivrFlowId: null },
    });
    await this.prisma.ivrFlow.delete({ where: { id } });
    return { success: true };
  }

  /** Only one flow per tenant answers inbound calls. */
  private async deactivateOthers(tenantId: string, exceptId?: string) {
    await this.prisma.ivrFlow.updateMany({
      where: {
        tenantId,
        isActive: true,
        id: exceptId ? { not: exceptId } : undefined,
      },
      data: { isActive: false },
    });
  }

  private assertUniqueDigits(options: IvrOptionDto[]) {
    const digits = options.map((o) => o.digit);
    const dupe = digits.find((d, i) => digits.indexOf(d) !== i);
    if (dupe) {
      throw new BadRequestException(
        `Duplicate IVR key "${dupe}" in menu options`,
      );
    }
  }
}
