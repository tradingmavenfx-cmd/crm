import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ContactsService', () => {
  let service: ContactsService;
  let prisma: {
    contact: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      contact: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: prisma },
        // The workflow engine listens for these; nothing here asserts on them.
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(ContactsService);
  });

  it('creates a contact scoped to the tenant and lowercases email', async () => {
    prisma.contact.create.mockResolvedValue({ id: 'c1' });

    await service.create(tenantId, {
      firstName: 'Asha',
      lastName: 'Verma',
      email: 'ASHA@Example.com',
    });

    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        email: 'asha@example.com',
        score: 0,
      }),
    });
  });

  it('paginates and returns meta', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.contact.count.mockResolvedValue(1);

    const result = await service.findAll(tenantId, { page: 1, limit: 20 });

    expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, pages: 1 });
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId }, skip: 0, take: 20 }),
    );
  });

  it('builds a case-insensitive search filter', async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.contact.count.mockResolvedValue(0);

    await service.findAll(tenantId, { search: 'asha', page: 1, limit: 10 });

    const arg = prisma.contact.findMany.mock.calls[0][0];
    expect(arg.where.OR).toHaveLength(3);
    expect(arg.where.tenantId).toBe(tenantId);
  });

  it('throws NotFound when contact is missing for tenant', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);

    await expect(service.findOne(tenantId, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('prevents cross-tenant deletion via existence check', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);

    await expect(
      service.remove(tenantId, 'other-tenant-contact'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.contact.delete).not.toHaveBeenCalled();
  });
});
