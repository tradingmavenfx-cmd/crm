import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DealsService } from './deals.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DealsService', () => {
  let service: DealsService;
  let prisma: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      dealStage: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      deal: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(DealsService);
  });

  it('rejects creating a deal with a stage from another tenant', async () => {
    prisma.dealStage.findFirst.mockResolvedValue(null);

    await expect(
      service.create(tenantId, { title: 'Big deal', stageId: 'foreign-stage' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.deal.create).not.toHaveBeenCalled();
  });

  it('creates a deal when the stage belongs to the tenant', async () => {
    prisma.dealStage.findFirst.mockResolvedValue({ id: 's1', tenantId });
    prisma.deal.create.mockResolvedValue({ id: 'd1' });

    await service.create(tenantId, {
      title: 'Big deal',
      stageId: 's1',
      value: '150000',
    });

    expect(prisma.deal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        stageId: 's1',
        currency: 'INR',
        status: 'open',
      }),
    });
  });

  it('throws NotFound updating a deal outside the tenant', async () => {
    prisma.deal.findFirst.mockResolvedValue(null);

    await expect(
      service.update(tenantId, 'missing', { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sets closedAt when a deal is marked won', async () => {
    prisma.deal.findFirst.mockResolvedValue({ id: 'd1', tenantId });
    prisma.deal.update.mockResolvedValue({ id: 'd1', status: 'won' });

    await service.update(tenantId, 'd1', { status: 'won' });

    const arg = prisma.deal.update.mock.calls[0][0];
    expect(arg.data.closedAt).toBeInstanceOf(Date);
  });
});
