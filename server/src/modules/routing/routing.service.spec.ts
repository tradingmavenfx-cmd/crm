import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { RoutingService } from './routing.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('RoutingService', () => {
  let service: RoutingService;
  let prisma: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      assignmentRule: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ assignedToId: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [RoutingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(RoutingService);
  });

  it('requires an agent for a "specific" rule', () => {
    expect(() =>
      service.createRule(tenantId, { name: 'Sales', strategy: 'specific' }),
    ).toThrow(BadRequestException);
  });

  it('assigns on a keyword match', async () => {
    prisma.assignmentRule.findMany.mockResolvedValue([
      {
        id: 'r1',
        name: 'Billing',
        conditions: { keywords: ['invoice', 'refund'] },
        strategy: 'specific',
        assignToId: 'u-billing',
      },
    ]);

    const agent = await service.autoAssign(
      tenantId,
      'conv1',
      Channel.EMAIL,
      'I need a copy of my INVOICE please',
    );

    expect(agent).toBe('u-billing');
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { assignedToId: 'u-billing' },
    });
  });

  it('falls through a rule whose keywords do not match', async () => {
    prisma.assignmentRule.findMany.mockResolvedValue([
      {
        id: 'r1',
        name: 'Billing',
        conditions: { keywords: ['invoice'] },
        strategy: 'specific',
        assignToId: 'u-billing',
      },
      {
        id: 'r2',
        name: 'Catch-all',
        conditions: {},
        strategy: 'specific',
        assignToId: 'u-general',
      },
    ]);

    const agent = await service.autoAssign(
      tenantId,
      'conv1',
      Channel.SMS,
      'when does the demo start?',
    );

    expect(agent).toBe('u-general');
  });

  it('picks the least loaded agent for round robin', async () => {
    prisma.assignmentRule.findMany.mockResolvedValue([
      { id: 'r1', name: 'Spread', conditions: {}, strategy: 'round_robin' },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'busy', _count: { assignedConversations: 7 } },
      { id: 'free', _count: { assignedConversations: 1 } },
    ]);

    const agent = await service.autoAssign(
      tenantId,
      'conv1',
      Channel.SMS,
      'hi',
    );

    expect(agent).toBe('free');
  });

  it('never reassigns a conversation that already has an owner', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      assignedToId: 'someone',
    });

    const agent = await service.autoAssign(
      tenantId,
      'conv1',
      Channel.SMS,
      'hi',
    );

    expect(agent).toBeNull();
    expect(prisma.assignmentRule.findMany).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when routing blows up', async () => {
    prisma.conversation.findFirst.mockRejectedValue(new Error('db down'));

    await expect(
      service.autoAssign(tenantId, 'conv1', Channel.SMS, 'hi'),
    ).resolves.toBeNull();
  });

  it('matches rules for the channel or for all channels', async () => {
    await service.autoAssign(tenantId, 'conv1', Channel.LIVE_CHAT, 'hi');

    const arg = prisma.assignmentRule.findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { channel: Channel.LIVE_CHAT },
      { channel: null },
    ]);
  });
});
