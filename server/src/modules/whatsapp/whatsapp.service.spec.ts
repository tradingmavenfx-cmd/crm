import { Test } from '@nestjs/testing';
import { MessageStatus } from '@prisma/client';
import { WhatsappService } from './whatsapp.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from './providers/whatsapp-provider.interface';

describe('WhatsappService', () => {
  let service: WhatsappService;
  let prisma: any;
  let provider: jest.Mocked<WhatsAppProvider>;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      conversation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      contact: { findFirst: jest.fn() },
      message: {
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      tenant: { findFirst: jest.fn() },
    };
    provider = {
      sendText: jest.fn().mockResolvedValue({ externalId: 'wamid.1' }),
      sendTemplate: jest.fn().mockResolvedValue({ externalId: 'wamid.2' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: PrismaService, useValue: prisma },
        { provide: WHATSAPP_PROVIDER, useValue: provider },
      ],
    }).compile();

    service = moduleRef.get(WhatsappService);
  });

  it('sends a text message, creating a conversation and linking a matching contact', async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.contact.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.conversation.create.mockResolvedValue({ id: 'conv1' });
    prisma.message.create.mockResolvedValue({ id: 'm1' });
    prisma.conversation.update.mockResolvedValue({});

    await service.send(tenantId, { to: '+919876543210', text: 'Hello' });

    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        externalId: '+919876543210',
        contactId: 'c1',
      }),
    });
    expect(provider.sendText).toHaveBeenCalledWith({
      to: '+919876543210',
      text: 'Hello',
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'OUTBOUND',
        externalId: 'wamid.1',
        status: MessageStatus.SENT,
      }),
    });
  });

  it('reuses an existing conversation', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-existing' });
    prisma.message.create.mockResolvedValue({ id: 'm1' });
    prisma.conversation.update.mockResolvedValue({});

    await service.send(tenantId, { to: '+911111111111', text: 'Hi again' });

    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: 'conv-existing' }),
    });
  });

  it('sends a template message when templateName is provided', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });
    prisma.message.create.mockResolvedValue({ id: 'm1' });
    prisma.conversation.update.mockResolvedValue({});

    await service.send(tenantId, {
      to: '+912222222222',
      templateName: 'order_update',
      languageCode: 'en',
      parameters: ['#123'],
    });

    expect(provider.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'order_update',
        parameters: ['#123'],
      }),
    );
    expect(provider.sendText).not.toHaveBeenCalled();
  });

  it('records an inbound message from a webhook payload', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: tenantId });
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });
    prisma.message.create.mockResolvedValue({ id: 'm-in' });
    prisma.conversation.update.mockResolvedValue({});

    await service.handleWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'pn-1' },
                messages: [
                  {
                    id: 'wamid.in',
                    from: '+913333333333',
                    type: 'text',
                    text: { body: 'Need help' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'INBOUND',
        body: 'Need help',
        status: MessageStatus.RECEIVED,
      }),
    });
  });

  it('assigns a conversation to an agent (tenant-scoped)', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv1', tenantId });
    prisma.conversation.update.mockResolvedValue({
      id: 'conv1',
      assignedToId: 'u9',
    });

    await service.updateConversation(tenantId, 'conv1', {
      assignedToId: 'u9',
      status: 'pending',
    });

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv1' },
        data: expect.objectContaining({
          assignedToId: 'u9',
          status: 'pending',
        }),
      }),
    );
  });

  it('clears assignment when assignedToId is an empty string', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv1', tenantId });
    prisma.conversation.update.mockResolvedValue({ id: 'conv1' });

    await service.updateConversation(tenantId, 'conv1', { assignedToId: '' });

    const arg = prisma.conversation.update.mock.calls[0][0];
    expect(arg.data.assignedToId).toBeNull();
  });

  it('adds an internal note (not sent to the customer)', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'conv1', tenantId });
    prisma.message.create.mockResolvedValue({ id: 'note1' });

    await service.addNote(
      tenantId,
      'conv1',
      'agent-1',
      'VIP customer, handle with care',
    );

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'note',
        isInternal: true,
        authorId: 'agent-1',
        body: 'VIP customer, handle with care',
      }),
    });
    expect(provider.sendText).not.toHaveBeenCalled();
  });

  it('maps a delivery status callback to the stored message', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ id: tenantId });
    prisma.message.updateMany.mockResolvedValue({ count: 1 });

    await service.handleWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'pn-1' },
                statuses: [{ id: 'wamid.1', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    });

    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { externalId: 'wamid.1' },
      data: { status: MessageStatus.DELIVERED },
    });
  });
});
