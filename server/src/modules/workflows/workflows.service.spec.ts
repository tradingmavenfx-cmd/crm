import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Channel, WorkflowRunStatus, WorkflowTrigger } from '@prisma/client';
import { WorkflowsService } from './workflows.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SequencesService } from '../sequences/sequences.service';
import { WorkflowEvent } from './workflow-events';

const workflow = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  tenantId: 'tenant-1',
  name: 'Test workflow',
  isActive: true,
  trigger: WorkflowTrigger.RECORD_CREATED,
  triggerEntity: 'contact',
  triggerConfig: {},
  conditions: {},
  actions: [],
  lastRunAt: null,
  ...over,
});

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let prisma: any;
  let email: { send: jest.Mock };
  let sms: { send: jest.Mock };
  let whatsapp: { send: jest.Mock };
  let sequences: { enroll: jest.Mock };
  const tenantId = 'tenant-1';

  const fire = (over: Partial<WorkflowEvent> = {}) =>
    service.handleEvent({
      tenantId,
      trigger: WorkflowTrigger.RECORD_CREATED,
      entity: 'contact',
      record: { id: 'c1', firstName: 'Priya', score: 65, email: 'p@g.in' },
      ...over,
    } as WorkflowEvent);

  const lastRun = () => prisma.workflowRun.create.mock.calls.at(-1)[0].data;

  beforeEach(async () => {
    prisma = {
      workflow: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
      workflowRun: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _avg: { durationMs: 0 },
        }),
      },
      task: { create: jest.fn().mockResolvedValue({ id: 't1', title: 'T' }) },
      activity: { create: jest.fn().mockResolvedValue({}) },
      contact: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      deal: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'u1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    email = { send: jest.fn().mockResolvedValue({ id: 'm-email' }) };
    sms = { send: jest.fn().mockResolvedValue({ id: 'm-sms' }) };
    whatsapp = { send: jest.fn().mockResolvedValue({ id: 'm-wa' }) };
    sequences = {
      enroll: jest.fn().mockResolvedValue({ enrolled: 1, skipped: 0 }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: SmsService, useValue: sms },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: SequencesService, useValue: sequences },
      ],
    }).compile();

    service = moduleRef.get(WorkflowsService);
  });

  // ── Trigger matching ───────────────────────────

  it('runs a workflow whose trigger and entity match', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        actions: [
          { type: 'create_task', config: { title: 'Call {{firstName}}' } },
        ],
      }),
    ]);

    await fire();

    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Call Priya' }),
    });
    expect(lastRun().status).toBe(WorkflowRunStatus.SUCCESS);
  });

  it('ignores a workflow watching a different entity', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        triggerEntity: 'deal',
        actions: [{ type: 'create_task', config: {} }],
      }),
    ]);

    await fire();

    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.workflowRun.create).not.toHaveBeenCalled();
  });

  it('matches FIELD_CHANGED only on the configured field', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        trigger: WorkflowTrigger.FIELD_CHANGED,
        triggerConfig: { field: 'score' },
        actions: [{ type: 'create_task', config: { title: 'x' } }],
      }),
    ]);

    await fire({
      trigger: WorkflowTrigger.FIELD_CHANGED,
      changed: { field: 'email', from: 'a', to: 'b' },
    });
    expect(prisma.task.create).not.toHaveBeenCalled();

    await fire({
      trigger: WorkflowTrigger.FIELD_CHANGED,
      changed: { field: 'score', from: 10, to: 90 },
    });
    expect(prisma.task.create).toHaveBeenCalled();
  });

  it('matches MESSAGE_RECEIVED only on the configured channel', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        trigger: WorkflowTrigger.MESSAGE_RECEIVED,
        triggerEntity: null,
        triggerConfig: { channel: Channel.SMS },
        actions: [{ type: 'create_task', config: { title: 'x' } }],
      }),
    ]);

    await fire({
      trigger: WorkflowTrigger.MESSAGE_RECEIVED,
      entity: undefined,
      channel: Channel.EMAIL,
    });
    expect(prisma.task.create).not.toHaveBeenCalled();

    await fire({
      trigger: WorkflowTrigger.MESSAGE_RECEIVED,
      entity: undefined,
      channel: Channel.SMS,
    });
    expect(prisma.task.create).toHaveBeenCalled();
  });

  it('matches a webhook only on its own key', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        trigger: WorkflowTrigger.WEBHOOK,
        triggerEntity: null,
        triggerConfig: { key: 'typeform' },
        actions: [{ type: 'create_task', config: { title: 'x' } }],
      }),
    ]);

    await fire({
      trigger: WorkflowTrigger.WEBHOOK,
      entity: undefined,
      webhookKey: 'other',
    });
    expect(prisma.task.create).not.toHaveBeenCalled();

    await fire({
      trigger: WorkflowTrigger.WEBHOOK,
      entity: undefined,
      webhookKey: 'typeform',
    });
    expect(prisma.task.create).toHaveBeenCalled();
  });

  // ── Conditions ─────────────────────────────────

  it('records a skipped run when conditions do not match', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        conditions: { all: [{ field: 'score', op: 'gte', value: 90 }] },
        actions: [{ type: 'create_task', config: { title: 'x' } }],
      }),
    ]);

    await fire();

    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(lastRun()).toMatchObject({
      status: WorkflowRunStatus.SKIPPED,
      message: 'Conditions not met',
    });
    // A skipped run must not inflate the workflow's run count.
    expect(prisma.workflow.update).not.toHaveBeenCalled();
  });

  // ── Actions ────────────────────────────────────

  it('sends email to the record address with merge fields rendered', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        actions: [
          {
            type: 'send_email',
            config: { subject: 'Hi {{firstName}}', body: 'Score {{score}}' },
          },
        ],
      }),
    ]);

    await fire();

    expect(email.send).toHaveBeenCalledWith(tenantId, {
      to: 'p@g.in',
      subject: 'Hi Priya',
      html: 'Score 65',
    });
  });

  it('fails the step when the record has no address', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({ actions: [{ type: 'send_sms', config: { text: 'hi' } }] }),
    ]);

    await fire({ record: { id: 'c1', firstName: 'Priya' } });

    expect(sms.send).not.toHaveBeenCalled();
    expect(lastRun()).toMatchObject({
      status: WorkflowRunStatus.FAILED,
      message: 'No phone number on the record',
    });
  });

  it('stops at the first failing action', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        actions: [
          { type: 'send_sms', config: { text: 'hi' } },
          { type: 'create_task', config: { title: 'should not run' } },
        ],
      }),
    ]);

    await fire({ record: { id: 'c1' } });

    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(lastRun().steps).toHaveLength(1);
  });

  it('assigns round robin to the agent with fewest open tasks', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'busy', _count: { assignedTasks: 5 } },
      { id: 'free', _count: { assignedTasks: 0 } },
    ]);
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        actions: [
          { type: 'assign_owner', config: { strategy: 'round_robin' } },
        ],
      }),
    ]);

    await fire();

    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', tenantId },
      data: { ownerId: 'free' },
    });
  });

  it('enrols the contact into a sequence', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        actions: [{ type: 'add_to_sequence', config: { sequenceId: 's1' } }],
      }),
    ]);

    await fire();

    expect(sequences.enroll).toHaveBeenCalledWith(tenantId, 's1', ['c1']);
  });

  it('records a failed run when a webhook action gets a bad status', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 500 } as Response);

    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        actions: [
          { type: 'webhook', config: { url: 'https://hooks.test/{{id}}' } },
        ],
      }),
    ]);

    await fire();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.test/c1',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(lastRun()).toMatchObject({
      status: WorkflowRunStatus.FAILED,
      message: 'Webhook returned 500',
    });
    fetchMock.mockRestore();
  });

  it('never lets a workflow failure escape into the emitter', async () => {
    prisma.workflow.findMany.mockRejectedValue(new Error('db down'));
    await expect(fire()).resolves.toBeUndefined();
  });

  // ── Schedules ──────────────────────────────────

  it('fires an everyMinutes schedule once the interval has passed', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        trigger: WorkflowTrigger.SCHEDULE,
        triggerEntity: null,
        triggerConfig: { everyMinutes: 30 },
        lastRunAt: new Date(Date.now() - 31 * 60 * 1000),
        actions: [{ type: 'create_task', config: { title: 'sweep' } }],
      }),
    ]);

    await service.runScheduled();

    expect(prisma.task.create).toHaveBeenCalled();
  });

  it('leaves an everyMinutes schedule alone before the interval', async () => {
    prisma.workflow.findMany.mockResolvedValue([
      workflow({
        trigger: WorkflowTrigger.SCHEDULE,
        triggerEntity: null,
        triggerConfig: { everyMinutes: 30 },
        lastRunAt: new Date(Date.now() - 5 * 60 * 1000),
        actions: [{ type: 'create_task', config: { title: 'sweep' } }],
      }),
    ]);

    await service.runScheduled();

    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  // ── Templates & dry run ────────────────────────

  it('installs a template paused so it can be reviewed first', async () => {
    prisma.workflow.create.mockResolvedValue({ id: 'new' });

    await service.installTemplate(tenantId, 'u1', 'lead-assignment');

    expect(prisma.workflow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isActive: false,
        name: 'Lead assignment',
      }),
    });
  });

  it('rejects an unknown template', async () => {
    await expect(
      service.installTemplate(tenantId, 'u1', 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dry run reports the match and the rendered actions without acting', async () => {
    prisma.workflow.findFirst.mockResolvedValue(
      workflow({
        conditions: { all: [{ field: 'score', op: 'gte', value: 50 }] },
        actions: [
          { type: 'create_task', config: { title: 'Call {{firstName}}' } },
        ],
      }),
    );

    const result = await service.test(tenantId, 'w1', {
      firstName: 'Priya',
      score: 65,
    });

    expect(result.matched).toBe(true);
    expect(result.wouldRun[0].preview).toEqual({ title: 'Call Priya' });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('scopes workflow lookups to the tenant', async () => {
    prisma.workflow.findFirst.mockResolvedValue(null);
    await expect(service.getWorkflow(tenantId, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
