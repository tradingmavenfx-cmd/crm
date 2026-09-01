import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Channel,
  Contact,
  EnrollmentStatus,
  MessageDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import {
  CreateSequenceDto,
  SequenceStepDto,
  UpdateSequenceDto,
} from './dto/sequence.dto';

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class SequencesService {
  private readonly logger = new Logger('SequencesService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private personalise(body: string, contact: Contact): string {
    const values: Record<string, string> = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: `${contact.firstName} ${contact.lastName}`,
      email: contact.email ?? '',
    };
    return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
      values[key] !== undefined ? values[key] : match,
    );
  }

  // ── Sequence CRUD ────────────────────────────

  listSequences(tenantId: string) {
    return this.prisma.sequence.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        steps: { orderBy: { order: 'asc' } },
        _count: { select: { enrollments: true } },
      },
    });
  }

  async getSequence(tenantId: string, id: string) {
    const sequence = await this.prisma.sequence.findFirst({
      where: { id, tenantId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!sequence) throw new NotFoundException('Sequence not found');
    return sequence;
  }

  createSequence(tenantId: string, dto: CreateSequenceDto) {
    return this.prisma.sequence.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive ?? true,
        stopOnReply: dto.stopOnReply ?? true,
        steps: {
          create: dto.steps.map((step, order) => ({ ...step, order })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async updateSequence(tenantId: string, id: string, dto: UpdateSequenceDto) {
    await this.getSequence(tenantId, id);

    // Steps are positional, so a change replaces the whole chain rather than
    // trying to reconcile individual rows against in-flight enrolments.
    if (dto.steps) {
      await this.prisma.sequenceStep.deleteMany({ where: { sequenceId: id } });
    }

    return this.prisma.sequence.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive,
        stopOnReply: dto.stopOnReply,
        steps: dto.steps
          ? {
              create: dto.steps.map((step: SequenceStepDto, order) => ({
                ...step,
                order,
              })),
            }
          : undefined,
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async removeSequence(tenantId: string, id: string) {
    await this.getSequence(tenantId, id);
    await this.prisma.sequence.delete({ where: { id } });
    return { success: true };
  }

  // ── Enrolment ────────────────────────────────

  /** Enrols contacts, skipping ones already in the sequence or without email. */
  async enroll(tenantId: string, sequenceId: string, contactIds: string[]) {
    const sequence = await this.getSequence(tenantId, sequenceId);
    if (!sequence.steps.length) {
      throw new BadRequestException('Sequence has no steps to send');
    }

    const contacts = await this.prisma.contact.findMany({
      where: { tenantId, id: { in: contactIds } },
    });

    const results: { contactId: string; status: string; reason?: string }[] =
      [];

    for (const contact of contacts) {
      if (!contact.email) {
        results.push({
          contactId: contact.id,
          status: 'skipped',
          reason: 'no_email',
        });
        continue;
      }

      const existing = await this.prisma.sequenceEnrollment.findUnique({
        where: { sequenceId_contactId: { sequenceId, contactId: contact.id } },
      });
      if (existing) {
        results.push({
          contactId: contact.id,
          status: 'skipped',
          reason: 'already_enrolled',
        });
        continue;
      }

      await this.prisma.sequenceEnrollment.create({
        data: {
          tenantId,
          sequenceId,
          contactId: contact.id,
          nextRunAt: new Date(
            Date.now() + sequence.steps[0].delayHours * HOUR_MS,
          ),
        },
      });
      results.push({ contactId: contact.id, status: 'enrolled' });
    }

    return {
      enrolled: results.filter((r) => r.status === 'enrolled').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      results,
    };
  }

  listEnrollments(tenantId: string, sequenceId: string) {
    return this.prisma.sequenceEnrollment.findMany({
      where: { tenantId, sequenceId },
      orderBy: { enrolledAt: 'desc' },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async stopEnrollment(
    tenantId: string,
    enrollmentId: string,
    reason = 'manual',
  ) {
    const enrollment = await this.prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, tenantId },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    return this.prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: EnrollmentStatus.STOPPED, stopReason: reason },
    });
  }

  /**
   * Stops every active enrolment for a contact. Called when they reply, so a
   * drip chain never keeps emailing someone who already answered.
   */
  async stopOnReply(tenantId: string, contactId: string): Promise<number> {
    const result = await this.prisma.sequenceEnrollment.updateMany({
      where: {
        tenantId,
        contactId,
        status: EnrollmentStatus.ACTIVE,
        sequence: { stopOnReply: true },
      },
      data: { status: EnrollmentStatus.STOPPED, stopReason: 'replied' },
    });
    if (result.count) {
      this.logger.log(
        `Stopped ${result.count} sequence enrolment(s) after a reply from ${contactId}`,
      );
    }
    return result.count;
  }

  // ── Runner ───────────────────────────────────

  /** Sends any sequence step that has come due. */
  @Cron(CronExpression.EVERY_MINUTE)
  async runDueSteps(): Promise<void> {
    const due = await this.prisma.sequenceEnrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        nextRunAt: { lte: new Date() },
      },
      include: {
        contact: true,
        sequence: { include: { steps: { orderBy: { order: 'asc' } } } },
      },
      take: 100,
    });

    for (const enrollment of due) {
      try {
        await this.runStep(enrollment);
      } catch (err) {
        this.logger.error(
          `Sequence step failed for enrolment ${enrollment.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        // Push the retry out an hour rather than hammering a failing provider.
        await this.prisma.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { nextRunAt: new Date(Date.now() + HOUR_MS) },
        });
      }
    }
  }

  private async runStep(enrollment: {
    id: string;
    tenantId: string;
    currentStep: number;
    contact: Contact;
    sequence: {
      isActive: boolean;
      steps: { subject: string; body: string; delayHours: number }[];
    };
  }): Promise<void> {
    const { sequence, contact, currentStep } = enrollment;

    if (!sequence.isActive) return;

    const step = sequence.steps[currentStep];
    if (!step || !contact.email) {
      await this.complete(enrollment.id);
      return;
    }

    await this.email.send(enrollment.tenantId, {
      to: contact.email,
      subject: this.personalise(step.subject, contact),
      html: this.personalise(step.body, contact),
    });

    const nextIndex = currentStep + 1;
    const nextStep = sequence.steps[nextIndex];

    if (!nextStep) {
      await this.complete(enrollment.id, nextIndex);
      return;
    }

    await this.prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        currentStep: nextIndex,
        nextRunAt: new Date(Date.now() + nextStep.delayHours * HOUR_MS),
      },
    });
  }

  private complete(id: string, currentStep?: number) {
    return this.prisma.sequenceEnrollment.update({
      where: { id },
      data: {
        status: EnrollmentStatus.COMPLETED,
        completedAt: new Date(),
        currentStep,
      },
    });
  }

  // ── Reply detection ──────────────────────────

  /**
   * Looks for inbound email from contacts with active enrolments and stops
   * their chains. Runs alongside the step runner so a reply that arrives via a
   * webhook is honoured even if nothing else notices it.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async stopRepliedEnrollments(): Promise<void> {
    const active = await this.prisma.sequenceEnrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        sequence: { stopOnReply: true },
      },
      select: { id: true, tenantId: true, contactId: true, enrolledAt: true },
    });

    for (const enrollment of active) {
      const replied = await this.prisma.message.findFirst({
        where: {
          tenantId: enrollment.tenantId,
          channel: Channel.EMAIL,
          direction: MessageDirection.INBOUND,
          createdAt: { gte: enrollment.enrolledAt },
          conversation: { contactId: enrollment.contactId },
        },
        select: { id: true },
      });

      if (replied) {
        await this.prisma.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: EnrollmentStatus.STOPPED, stopReason: 'replied' },
        });
      }
    }
  }
}
