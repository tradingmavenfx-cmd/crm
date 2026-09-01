import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EnrollmentStatus } from '@prisma/client';
import { SequencesService } from './sequences.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

const HOUR = 60 * 60 * 1000;

describe('SequencesService', () => {
  let service: SequencesService;
  let prisma: any;
  let email: { send: jest.Mock };
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      sequence: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      sequenceStep: { deleteMany: jest.fn() },
      sequenceEnrollment: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'e1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
      message: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    email = { send: jest.fn().mockResolvedValue({ id: 'm1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SequencesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = moduleRef.get(SequencesService);
  });

  // ── Enrolment ──────────────────────────────────

  it('enrols a contact and schedules the first step by its delay', async () => {
    prisma.sequence.findFirst.mockResolvedValue({
      id: 's1',
      tenantId,
      steps: [{ order: 0, delayHours: 48, subject: 'Hi', body: 'x' }],
    });
    prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', email: 'priya@globex.in' },
    ]);

    const before = Date.now();
    const result = await service.enroll(tenantId, 's1', ['c1']);

    expect(result).toMatchObject({ enrolled: 1, skipped: 0 });
    const { nextRunAt } =
      prisma.sequenceEnrollment.create.mock.calls[0][0].data;
    expect(nextRunAt.getTime()).toBeGreaterThanOrEqual(
      before + 48 * HOUR - 1000,
    );
  });

  it('skips a contact with no email', async () => {
    prisma.sequence.findFirst.mockResolvedValue({
      id: 's1',
      tenantId,
      steps: [{ order: 0, delayHours: 0, subject: 'Hi', body: 'x' }],
    });
    prisma.contact.findMany.mockResolvedValue([{ id: 'c1', email: null }]);

    const result = await service.enroll(tenantId, 's1', ['c1']);

    expect(result.results[0]).toMatchObject({
      status: 'skipped',
      reason: 'no_email',
    });
    expect(prisma.sequenceEnrollment.create).not.toHaveBeenCalled();
  });

  it('does not enrol the same contact twice', async () => {
    prisma.sequence.findFirst.mockResolvedValue({
      id: 's1',
      tenantId,
      steps: [{ order: 0, delayHours: 0, subject: 'Hi', body: 'x' }],
    });
    prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', email: 'priya@globex.in' },
    ]);
    prisma.sequenceEnrollment.findUnique.mockResolvedValue({ id: 'existing' });

    const result = await service.enroll(tenantId, 's1', ['c1']);

    expect(result.results[0]).toMatchObject({ reason: 'already_enrolled' });
    expect(prisma.sequenceEnrollment.create).not.toHaveBeenCalled();
  });

  it('refuses to enrol into a sequence with no steps', async () => {
    prisma.sequence.findFirst.mockResolvedValue({
      id: 's1',
      tenantId,
      steps: [],
    });

    await expect(service.enroll(tenantId, 's1', ['c1'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ── Runner ─────────────────────────────────────

  it('sends the due step, personalised, and schedules the next one', async () => {
    prisma.sequenceEnrollment.findMany.mockResolvedValue([
      {
        id: 'e1',
        tenantId,
        currentStep: 0,
        contact: {
          id: 'c1',
          firstName: 'Priya',
          lastName: 'Sharma',
          email: 'priya@globex.in',
        },
        sequence: {
          isActive: true,
          steps: [
            {
              subject: 'Hi {{firstName}}',
              body: 'Hello {{fullName}}',
              delayHours: 0,
            },
            { subject: 'Following up', body: 'Still there?', delayHours: 72 },
          ],
        },
      },
    ]);

    await service.runDueSteps();

    expect(email.send).toHaveBeenCalledWith(tenantId, {
      to: 'priya@globex.in',
      subject: 'Hi Priya',
      html: 'Hello Priya Sharma',
    });
    const update = prisma.sequenceEnrollment.update.mock.calls[0][0];
    expect(update.data.currentStep).toBe(1);
  });

  it('completes the enrolment after the last step', async () => {
    prisma.sequenceEnrollment.findMany.mockResolvedValue([
      {
        id: 'e1',
        tenantId,
        currentStep: 0,
        contact: { id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com' },
        sequence: {
          isActive: true,
          steps: [{ subject: 'Only', body: 'step', delayHours: 0 }],
        },
      },
    ]);

    await service.runDueSteps();

    expect(prisma.sequenceEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EnrollmentStatus.COMPLETED }),
      }),
    );
  });

  it('leaves a paused sequence alone', async () => {
    prisma.sequenceEnrollment.findMany.mockResolvedValue([
      {
        id: 'e1',
        tenantId,
        currentStep: 0,
        contact: { id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com' },
        sequence: {
          isActive: false,
          steps: [{ subject: 'x', body: 'y', delayHours: 0 }],
        },
      },
    ]);

    await service.runDueSteps();

    expect(email.send).not.toHaveBeenCalled();
  });

  it('retries an hour later when a send fails', async () => {
    prisma.sequenceEnrollment.findMany.mockResolvedValue([
      {
        id: 'e1',
        tenantId,
        currentStep: 0,
        contact: { id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com' },
        sequence: {
          isActive: true,
          steps: [{ subject: 'x', body: 'y', delayHours: 0 }],
        },
      },
    ]);
    email.send.mockRejectedValue(new Error('smtp down'));

    const before = Date.now();
    await service.runDueSteps();

    const { nextRunAt } =
      prisma.sequenceEnrollment.update.mock.calls[0][0].data;
    expect(nextRunAt.getTime()).toBeGreaterThanOrEqual(before + HOUR - 1000);
  });

  // ── Stop on reply ──────────────────────────────

  it('stops active enrolments when a contact replies', async () => {
    prisma.sequenceEnrollment.updateMany.mockResolvedValue({ count: 2 });

    const stopped = await service.stopOnReply(tenantId, 'c1');

    expect(stopped).toBe(2);
    expect(prisma.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        contactId: 'c1',
        status: EnrollmentStatus.ACTIVE,
        sequence: { stopOnReply: true },
      },
      data: { status: EnrollmentStatus.STOPPED, stopReason: 'replied' },
    });
  });

  it('sweeps enrolments whose contact has replied since enrolling', async () => {
    prisma.sequenceEnrollment.findMany.mockResolvedValue([
      { id: 'e1', tenantId, contactId: 'c1', enrolledAt: new Date(0) },
    ]);
    prisma.message.findFirst.mockResolvedValue({ id: 'inbound-1' });

    await service.stopRepliedEnrollments();

    expect(prisma.sequenceEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: EnrollmentStatus.STOPPED, stopReason: 'replied' },
    });
  });

  it('leaves enrolments alone when there is no reply', async () => {
    prisma.sequenceEnrollment.findMany.mockResolvedValue([
      { id: 'e1', tenantId, contactId: 'c1', enrolledAt: new Date(0) },
    ]);
    prisma.message.findFirst.mockResolvedValue(null);

    await service.stopRepliedEnrollments();

    expect(prisma.sequenceEnrollment.update).not.toHaveBeenCalled();
  });
});
