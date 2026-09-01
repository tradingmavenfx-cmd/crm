import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, WorkflowTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WORKFLOW_EVENT } from '../workflows/workflow-events';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { QueryContactDto } from './dto/query-contact.dto';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async create(tenantId: string, dto: CreateContactDto) {
    const contact = await this.prisma.contact.create({
      data: {
        tenantId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email?.toLowerCase(),
        phone: dto.phone,
        jobTitle: dto.jobTitle,
        companyId: dto.companyId,
        ownerId: dto.ownerId,
        score: dto.score ?? 0,
      },
    });

    this.events.emit(WORKFLOW_EVENT, {
      tenantId,
      trigger: WorkflowTrigger.RECORD_CREATED,
      entity: 'contact',
      record: contact as unknown as Record<string, unknown>,
    });

    return contact;
  }

  async findAll(tenantId: string, query: QueryContactDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ContactWhereInput = { tenantId };
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contact.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  async update(tenantId: string, id: string, dto: UpdateContactDto) {
    const before = await this.findOne(tenantId, id); // tenant-scoped check
    const contact = await this.prisma.contact.update({
      where: { id },
      data: {
        ...dto,
        email: dto.email ? dto.email.toLowerCase() : dto.email,
      },
    });

    const record = contact as unknown as Record<string, unknown>;
    this.events.emit(WORKFLOW_EVENT, {
      tenantId,
      trigger: WorkflowTrigger.RECORD_UPDATED,
      entity: 'contact',
      record,
    });

    // One FIELD_CHANGED event per field that actually moved, so a workflow can
    // watch a single field without re-checking the whole record.
    for (const [field, to] of Object.entries(dto)) {
      const from = (before as unknown as Record<string, unknown>)[field];
      if (to === undefined || String(from) === String(to)) continue;
      this.events.emit(WORKFLOW_EVENT, {
        tenantId,
        trigger: WorkflowTrigger.FIELD_CHANGED,
        entity: 'contact',
        record,
        changed: { field, from, to },
      });
    }

    return contact;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.contact.delete({ where: { id } });
    return { success: true };
  }
}
