import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CallDirection, CallStatus } from '@prisma/client';
import { VoiceService } from './voice.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import {
  VOICE_PROVIDER,
  VoiceProvider,
} from './providers/voice-provider.interface';

const CONFIG: Record<string, unknown> = {
  'voice.publicUrl': 'http://localhost:4000/api',
  'voice.vipScoreThreshold': 70,
  'voice.voicemailMaxSec': 120,
  'voice.missedCallSms': 'Sorry we missed your call.',
};

describe('VoiceService', () => {
  let service: VoiceService;
  let prisma: any;
  let provider: jest.Mocked<VoiceProvider>;
  let sms: { send: jest.Mock };
  const tenantId = 'tenant-1';

  /**
   * Points findFirst at a call record and makes update resolve to the merged
   * row, the way Prisma does - the lifecycle handlers read the result back.
   */
  const mockCall = (record: Record<string, unknown>) => {
    prisma.call.findFirst.mockResolvedValue(record);
    prisma.call.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...record, ...data }),
    );
  };

  beforeEach(async () => {
    prisma = {
      call: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'call1' }),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'call1', ...data }),
          ),
        updateMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      ivrFlow: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        updateMany: jest.fn(),
      },
      conversation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'conv1' }),
        create: jest.fn().mockResolvedValue({ id: 'conv1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      contact: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'newlead', ownerId: null }),
      },
      user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      deal: { findFirst: jest.fn() },
      task: {
        create: jest.fn().mockResolvedValue({ id: 't1' }),
        findFirst: jest.fn(),
      },
      activity: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
      message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    };

    provider = {
      placeCall: jest.fn().mockResolvedValue({ externalId: 'CA123' }),
      renderIvr: jest.fn().mockReturnValue({
        contentType: 'application/json',
        body: '{}',
      }),
    };
    sms = { send: jest.fn().mockResolvedValue({ id: 'sms1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: SmsService, useValue: sms },
        { provide: VOICE_PROVIDER, useValue: provider },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => CONFIG[key] },
        },
        // The workflow engine listens for these; nothing here asserts on them.
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(VoiceService);
  });

  // ── Inbound & IVR ──────────────────────────────

  it('answers an inbound call with the active IVR menu', async () => {
    prisma.ivrFlow.findFirst.mockResolvedValue({
      id: 'flow1',
      greeting: 'Welcome to Acme.',
      options: [
        { digit: '1', label: 'sales', action: 'transfer', value: 'agent-1' },
        { digit: '2', label: 'support', action: 'voicemail' },
      ],
    });

    const action = await service.handleIncoming(tenantId, {
      from: '+919876543210',
      to: '+911140001000',
      externalId: 'CA123',
    });

    expect(action.say).toContain('Welcome to Acme.');
    expect(action.say).toContain('For sales, press 1.');
    expect(action.gather).toEqual(
      expect.objectContaining({
        numDigits: 1,
        actionUrl: 'http://localhost:4000/api/voice/webhook/tenant-1/dtmf',
      }),
    );
    expect(prisma.call.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: CallDirection.INBOUND,
        status: CallStatus.RINGING,
        externalId: 'CA123',
      }),
    });
  });

  it('routes a VIP caller straight to their account manager', async () => {
    prisma.contact.findMany.mockResolvedValue([
      {
        id: 'c1',
        phone: '+919876543210',
        score: 85,
        ownerId: 'u1',
        firstName: 'Priya',
      },
    ]);
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      firstName: 'Ravi',
      phone: '+911140002000',
    });

    const action = await service.handleIncoming(tenantId, {
      from: '+919876543210',
      externalId: 'CA124',
    });

    expect(action.dial).toEqual({ number: '+911140002000', timeoutSec: 25 });
    expect(prisma.call.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ agentId: 'u1', ivrPath: ['vip'] }),
      }),
    );
    expect(prisma.ivrFlow.findFirst).not.toHaveBeenCalled();
  });

  it('keeps a low-scoring caller in the normal menu', async () => {
    prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', phone: '+919876543210', score: 20, ownerId: 'u1' },
    ]);
    prisma.ivrFlow.findFirst.mockResolvedValue({
      id: 'flow1',
      greeting: 'Welcome.',
      options: [],
    });

    const action = await service.handleIncoming(tenantId, {
      from: '+919876543210',
      externalId: 'CA125',
    });

    expect(action.dial).toBeUndefined();
    expect(action.gather).toBeDefined();
  });

  it('adopts a known contact onto a call thread that pre-dates it', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv1',
      contactId: null,
    });
    prisma.conversation.update.mockResolvedValue({
      id: 'conv1',
      contactId: 'c1',
    });
    prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', phone: '+919876543210', score: 10, ownerId: null },
    ]);
    prisma.ivrFlow.findFirst.mockResolvedValue({
      id: 'flow1',
      greeting: 'Welcome.',
      options: [],
    });

    await service.handleIncoming(tenantId, {
      from: '+919876543210',
      externalId: 'CA127',
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { contactId: 'c1' },
    });
  });

  it('falls back to voicemail when no IVR flow is active', async () => {
    prisma.ivrFlow.findFirst.mockResolvedValue(null);

    const action = await service.handleIncoming(tenantId, {
      from: '+919876543210',
      externalId: 'CA126',
    });

    expect(action.record).toEqual(
      expect.objectContaining({
        maxLengthSec: 120,
        actionUrl: 'http://localhost:4000/api/voice/webhook/tenant-1/recording',
      }),
    );
  });

  it('transfers to an agent on the matching keypress', async () => {
    prisma.call.findFirst.mockResolvedValue({
      id: 'call1',
      tenantId,
      ivrFlowId: 'flow1',
      contactId: null,
    });
    prisma.ivrFlow.findFirst.mockResolvedValue({
      id: 'flow1',
      greeting: 'Welcome.',
      options: [
        {
          digit: '1',
          label: 'sales',
          action: 'transfer',
          value: '11111111-1111-4111-8111-111111111111',
        },
      ],
    });
    prisma.user.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      firstName: 'Ravi',
      phone: '+911140002000',
    });

    const action = await service.handleDtmf(tenantId, {
      externalId: 'CA123',
      digits: '1',
    });

    expect(action.dial?.number).toBe('+911140002000');
    expect(prisma.call.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ivrPath: { push: '1' } } }),
    );
  });

  it('takes a voicemail when the transfer target has no number', async () => {
    prisma.call.findFirst.mockResolvedValue({
      id: 'call1',
      tenantId,
      ivrFlowId: 'flow1',
      contactId: null,
    });
    prisma.ivrFlow.findFirst.mockResolvedValue({
      id: 'flow1',
      greeting: 'Welcome.',
      options: [
        {
          digit: '1',
          label: 'sales',
          action: 'transfer',
          value: '11111111-1111-4111-8111-111111111111',
        },
      ],
    });
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', phone: null });

    const action = await service.handleDtmf(tenantId, {
      externalId: 'CA123',
      digits: '1',
    });

    expect(action.record).toBeDefined();
    expect(action.dial).toBeUndefined();
  });

  it('descends into a submenu for a menu option', async () => {
    prisma.call.findFirst.mockResolvedValue({
      id: 'call1',
      tenantId,
      ivrFlowId: 'flow1',
      contactId: null,
    });
    prisma.ivrFlow.findFirst
      .mockResolvedValueOnce({
        id: 'flow1',
        greeting: 'Main menu.',
        options: [
          { digit: '2', label: 'billing', action: 'menu', value: 'flow2' },
        ],
      })
      .mockResolvedValueOnce({
        id: 'flow2',
        greeting: 'Billing menu.',
        options: [{ digit: '1', label: 'invoices', action: 'voicemail' }],
      });

    const action = await service.handleDtmf(tenantId, {
      externalId: 'CA123',
      digits: '2',
    });

    expect(action.say).toContain('Billing menu.');
    expect(prisma.call.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ivrFlowId: 'flow2' } }),
    );
  });

  it('re-reads the menu on an invalid keypress', async () => {
    prisma.call.findFirst.mockResolvedValue({
      id: 'call1',
      tenantId,
      ivrFlowId: 'flow1',
      contactId: null,
    });
    prisma.ivrFlow.findFirst.mockResolvedValue({
      id: 'flow1',
      greeting: 'Welcome.',
      options: [{ digit: '1', label: 'sales', action: 'hangup' }],
    });

    const action = await service.handleDtmf(tenantId, {
      externalId: 'CA123',
      digits: '9',
    });

    expect(action.say).toContain('not a valid option');
    expect(action.gather).toBeDefined();
    // An unrecognised key must not be recorded as a menu choice.
    expect(prisma.call.update).not.toHaveBeenCalled();
  });

  it('reads back live CRM data for a crm_lookup option', async () => {
    prisma.call.findFirst.mockResolvedValue({
      id: 'call1',
      tenantId,
      ivrFlowId: 'flow1',
      contactId: 'c1',
    });
    prisma.ivrFlow.findFirst.mockResolvedValue({
      id: 'flow1',
      greeting: 'Welcome.',
      options: [
        {
          digit: '3',
          label: 'order status',
          action: 'crm_lookup',
          value: 'deal',
        },
      ],
    });
    prisma.deal.findFirst.mockResolvedValue({
      title: 'Q3 Renewal',
      value: '250000',
      currency: 'INR',
      stage: { name: 'Negotiation' },
    });

    const action = await service.handleDtmf(tenantId, {
      externalId: 'CA123',
      digits: '3',
    });

    expect(action.say).toContain('Q3 Renewal');
    expect(action.say).toContain('Negotiation');
    expect(action.hangup).toBe(true);
  });

  it('handles crm_lookup for an unknown caller gracefully', async () => {
    prisma.call.findFirst.mockResolvedValue({
      id: 'call1',
      tenantId,
      ivrFlowId: 'flow1',
      contactId: null,
    });
    prisma.ivrFlow.findFirst.mockResolvedValue({
      id: 'flow1',
      greeting: 'Welcome.',
      options: [{ digit: '3', label: 'orders', action: 'crm_lookup' }],
    });

    const action = await service.handleDtmf(tenantId, {
      externalId: 'CA123',
      digits: '3',
    });

    expect(action.say).toContain('could not find your details');
    expect(prisma.deal.findFirst).not.toHaveBeenCalled();
  });

  // ── Call lifecycle ─────────────────────────────

  it('finalises a completed call and logs it to the inbox', async () => {
    mockCall({
      id: 'call1',
      tenantId,
      conversationId: 'conv1',
      direction: CallDirection.INBOUND,
      durationSec: 0,
      recordingUrl: null,
      answeredAt: null,
      ivrPath: ['1'],
      from: '+919876543210',
      contactId: 'c1',
      agentId: 'u1',
    });

    await service.handleStatus(tenantId, {
      externalId: 'CA123',
      status: 'completed',
      durationSec: 95,
    });

    expect(prisma.call.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CallStatus.COMPLETED,
          durationSec: 95,
        }),
      }),
    );
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'VOICE',
        type: 'call',
        body: expect.stringContaining('1m 35s'),
      }),
    });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('runs missed-call automation on an unanswered inbound call', async () => {
    mockCall({
      id: 'call1',
      tenantId,
      conversationId: 'conv1',
      direction: CallDirection.INBOUND,
      durationSec: 0,
      recordingUrl: null,
      answeredAt: null,
      ivrPath: [],
      from: '+919876543210',
      contactId: null,
      agentId: null,
    });
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await service.handleStatus(tenantId, {
      externalId: 'CA123',
      status: 'no-answer',
    });

    // Unknown caller becomes a lead...
    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: '+919876543210',
        lastName: 'Caller 3210',
      }),
    });
    // ...a callback task lands on an agent...
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Call back +919876543210',
        priority: 'high',
        assigneeId: 'u1',
      }),
    });
    expect(prisma.activity.create).toHaveBeenCalled();
    // ...the thread opened before the lead existed gets linked to it...
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { contactId: 'newlead' },
    });
    // ...and the caller gets a follow-up text.
    expect(sms.send).toHaveBeenCalledWith(tenantId, {
      to: '+919876543210',
      text: 'Sorry we missed your call.',
    });
  });

  it('does not fail the status callback when the follow-up SMS is rejected', async () => {
    mockCall({
      id: 'call1',
      tenantId,
      conversationId: 'conv1',
      direction: CallDirection.INBOUND,
      durationSec: 0,
      recordingUrl: null,
      answeredAt: null,
      ivrPath: [],
      from: '+919876543210',
      contactId: 'c1',
      agentId: 'u1',
    });
    prisma.contact.findFirst.mockResolvedValue({ id: 'c1', ownerId: 'u1' });
    sms.send.mockRejectedValue(new Error('opted out'));

    await expect(
      service.handleStatus(tenantId, { externalId: 'CA123', status: 'busy' }),
    ).resolves.toBeDefined();
    expect(prisma.task.create).toHaveBeenCalled();
  });

  it('skips missed-call automation for outbound calls', async () => {
    mockCall({
      id: 'call1',
      tenantId,
      conversationId: 'conv1',
      direction: CallDirection.OUTBOUND,
      durationSec: 0,
      recordingUrl: null,
      answeredAt: null,
      ivrPath: [],
      from: '+911140001000',
      contactId: 'c1',
      agentId: 'u1',
    });

    await service.handleStatus(tenantId, {
      externalId: 'CA123',
      status: 'no-answer',
    });

    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider status', async () => {
    mockCall({ id: 'call1', tenantId });
    await expect(
      service.handleStatus(tenantId, { externalId: 'CA123', status: 'wat' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a voicemail recording on the thread', async () => {
    mockCall({
      id: 'call1',
      tenantId,
      conversationId: 'conv1',
      durationSec: 0,
    });

    await service.handleRecording(tenantId, {
      externalId: 'CA123',
      recordingUrl: 'https://rec.example/1.mp3',
      transcript: 'Please call me back',
      durationSec: 12,
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'voicemail',
        body: 'Voicemail: "Please call me back"',
      }),
    });
  });

  // ── Click-to-call ──────────────────────────────

  it('places a click-to-call from the agent phone', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      phone: '+911140002000',
    });

    await service.clickToCall(tenantId, 'u1', { to: '+919876543210' });

    expect(provider.placeCall).toHaveBeenCalledWith({
      to: '+919876543210',
      agentNumber: '+911140002000',
    });
    expect(prisma.call.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: CallDirection.OUTBOUND,
        externalId: 'CA123',
        agentId: 'u1',
      }),
    });
  });

  it('refuses click-to-call when the agent has no number', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', phone: null });

    await expect(
      service.clickToCall(tenantId, 'u1', { to: '+919876543210' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.placeCall).not.toHaveBeenCalled();
  });

  // ── IVR flow management ────────────────────────

  it('rejects a menu with duplicate keys', async () => {
    await expect(
      service.createFlow(tenantId, {
        name: 'Main',
        greeting: 'Hi',
        options: [
          { digit: '1', label: 'sales', action: 'hangup' },
          { digit: '1', label: 'support', action: 'hangup' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ivrFlow.create).not.toHaveBeenCalled();
  });

  it('activating a flow deactivates the others', async () => {
    await service.createFlow(tenantId, {
      name: 'Main',
      greeting: 'Hi',
      isActive: true,
      options: [{ digit: '1', label: 'sales', action: 'hangup' }],
    });

    expect(prisma.ivrFlow.updateMany).toHaveBeenCalledWith({
      where: { tenantId, isActive: true, id: undefined },
      data: { isActive: false },
    });
  });

  it('detaches call history instead of cascading when a flow is deleted', async () => {
    prisma.ivrFlow.findFirst.mockResolvedValue({ id: 'flow1', tenantId });

    await service.removeFlow(tenantId, 'flow1');

    expect(prisma.call.updateMany).toHaveBeenCalledWith({
      where: { tenantId, ivrFlowId: 'flow1' },
      data: { ivrFlowId: null },
    });
    expect(prisma.ivrFlow.delete).toHaveBeenCalledWith({
      where: { id: 'flow1' },
    });
  });

  it('scopes flow lookups to the tenant', async () => {
    prisma.ivrFlow.findFirst.mockResolvedValue(null);
    await expect(service.getFlow(tenantId, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
