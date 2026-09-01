import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RoutingService } from '../routing/routing.service';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: any;
  let routing: { autoAssign: jest.Mock };
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      tenant: { findFirst: jest.fn().mockResolvedValue({ id: tenantId }) },
      chatVisitor: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      conversation: {
        upsert: jest.fn().mockResolvedValue({ id: 'conv1' }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      contact: { findFirst: jest.fn().mockResolvedValue(null) },
      message: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'm1', createdAt: new Date() }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    routing = { autoAssign: jest.fn().mockResolvedValue(null) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: RoutingService, useValue: routing },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
  });

  it('issues a visitor key for a new session', async () => {
    prisma.chatVisitor.create.mockResolvedValue({
      visitorKey: 'key-1',
      conversationId: null,
    });

    const result = await service.start(tenantId, { currentPage: '/pricing' });

    expect(result).toMatchObject({ visitorKey: 'key-1', resumed: false });
  });

  it('resumes an existing session instead of creating a second one', async () => {
    prisma.chatVisitor.findFirst.mockResolvedValue({
      id: 'v1',
      visitorKey: 'key-1',
    });
    prisma.chatVisitor.update.mockResolvedValue({
      visitorKey: 'key-1',
      conversationId: 'conv1',
    });

    const result = await service.start(tenantId, { visitorKey: 'key-1' });

    expect(result).toMatchObject({ resumed: true, conversationId: 'conv1' });
    expect(prisma.chatVisitor.create).not.toHaveBeenCalled();
  });

  it('rejects a session for an unknown workspace', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);
    await expect(service.start('nope', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates the thread on the first message and routes it', async () => {
    prisma.chatVisitor.findFirst.mockResolvedValue({
      id: 'v1',
      visitorKey: 'key-1',
      conversationId: null,
      email: null,
      currentPage: '/pricing',
    });

    await service.sendFromVisitor(tenantId, {
      visitorKey: 'key-1',
      text: 'Do you support GST invoices?',
    });

    expect(prisma.conversation.upsert).toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'LIVE_CHAT',
        direction: 'INBOUND',
        body: 'Do you support GST invoices?',
      }),
    });
    expect(routing.autoAssign).toHaveBeenCalledWith(
      tenantId,
      'conv1',
      'LIVE_CHAT',
      'Do you support GST invoices?',
    );
  });

  it('links a known contact when the visitor gave an email', async () => {
    prisma.chatVisitor.findFirst.mockResolvedValue({
      id: 'v1',
      visitorKey: 'key-1',
      conversationId: null,
      email: 'Priya@Globex.in',
    });
    prisma.contact.findFirst.mockResolvedValue({ id: 'c1' });

    await service.sendFromVisitor(tenantId, {
      visitorKey: 'key-1',
      text: 'hi',
    });

    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { tenantId, email: 'priya@globex.in' },
    });
    expect(prisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ contactId: 'c1' }),
      }),
    );
  });

  it('never shows internal notes to the visitor', async () => {
    prisma.chatVisitor.findFirst.mockResolvedValue({
      id: 'v1',
      visitorKey: 'key-1',
      conversationId: 'conv1',
    });

    await service.pollForVisitor(tenantId, 'key-1');

    const arg = prisma.message.findMany.mock.calls[0][0];
    expect(arg.where.isInternal).toBe(false);
  });

  it('returns nothing to poll before the first message', async () => {
    prisma.chatVisitor.findFirst.mockResolvedValue({
      id: 'v1',
      visitorKey: 'key-1',
      conversationId: null,
    });

    const result = await service.pollForVisitor(tenantId, 'key-1');

    expect(result).toEqual({ conversationId: null, messages: [] });
  });

  it('stores a post-chat rating on the conversation', async () => {
    prisma.chatVisitor.findFirst.mockResolvedValue({
      id: 'v1',
      visitorKey: 'key-1',
      conversationId: 'conv1',
    });

    await service.rate(tenantId, {
      visitorKey: 'key-1',
      rating: 5,
      comment: 'Quick help',
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { rating: 5, ratingComment: 'Quick help' },
    });
  });

  it('marks visitors idle beyond the online window as offline', async () => {
    prisma.chatVisitor.findMany.mockResolvedValue([
      { id: 'v1', lastSeenAt: new Date() },
      { id: 'v2', lastSeenAt: new Date(Date.now() - 30 * 60 * 1000) },
    ]);

    const visitors = await service.listVisitors(tenantId);

    expect(visitors.map((v) => v.online)).toEqual([true, false]);
  });

  it('serves a widget bound to the workspace and API base', () => {
    const script = service.widgetScript(
      tenantId,
      'https://api.example.com/api',
    );

    expect(script).toContain(tenantId);
    expect(script).toContain('https://api.example.com/api');
    expect(script).not.toContain('__TENANT_ID__');
  });
});
