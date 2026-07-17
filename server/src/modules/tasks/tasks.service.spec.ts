import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: any;
  const tenantId = 'tenant-1';
  const userId = 'user-1';

  beforeEach(async () => {
    prisma = {
      task: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TasksService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(TasksService);
  });

  it('creates a task with defaults and creator', async () => {
    prisma.task.create.mockResolvedValue({ id: 't1' });

    await service.create(tenantId, userId, { title: 'Follow up' });

    expect(prisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        creatorId: userId,
        title: 'Follow up',
        priority: 'medium',
      }),
    });
  });

  it('filters by status and assignee', async () => {
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.count.mockResolvedValue(0);

    await service.findAll(tenantId, { status: 'open', assigneeId: 'u2' });

    const arg = prisma.task.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId, status: 'open', assigneeId: 'u2' });
  });

  it('throws NotFound when updating a task from another tenant', async () => {
    prisma.task.findFirst.mockResolvedValue(null);

    await expect(
      service.update(tenantId, 'missing', { status: 'done' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
