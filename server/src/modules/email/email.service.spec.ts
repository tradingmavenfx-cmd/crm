import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { EmailService } from './email.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from './providers/email-provider.interface';

describe('EmailService', () => {
  let service: EmailService;
  let prisma: any;
  let provider: jest.Mocked<EmailProvider>;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      conversation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      contact: { findFirst: jest.fn() },
      message: { create: jest.fn() },
      emailTemplate: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    provider = { send: jest.fn().mockResolvedValue({ externalId: 'smtp-1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: PrismaService, useValue: prisma },
        { provide: EMAIL_PROVIDER, useValue: provider },
      ],
    }).compile();

    service = moduleRef.get(EmailService);
  });

  it('sends an email, lower-casing the address and linking a matching contact', async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.contact.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.conversation.create.mockResolvedValue({ id: 'conv1' });
    prisma.message.create.mockResolvedValue({ id: 'm1' });
    prisma.conversation.update.mockResolvedValue({});

    await service.send(tenantId, {
      to: 'Lead@Example.com',
      subject: 'Hello',
      html: '<b>Hi</b>',
    });

    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: 'lead@example.com',
        contactId: 'c1',
      }),
    });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'Lead@Example.com', subject: 'Hello' }),
    );
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        status: MessageStatus.SENT,
      }),
    });
  });

  it('uses a template when templateId is provided', async () => {
    prisma.emailTemplate.findFirst.mockResolvedValue({
      id: 'tpl1',
      subject: 'Welcome!',
      body: '<p>Onboarding</p>',
    });
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });
    prisma.message.create.mockResolvedValue({ id: 'm1' });
    prisma.conversation.update.mockResolvedValue({});

    await service.send(tenantId, {
      to: 'x@y.com',
      subject: '',
      templateId: 'tpl1',
    });

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Welcome!',
        html: '<p>Onboarding</p>',
      }),
    );
  });

  it('throws when the template is missing', async () => {
    prisma.emailTemplate.findFirst.mockResolvedValue(null);
    await expect(
      service.send(tenantId, {
        to: 'x@y.com',
        subject: 's',
        templateId: 'nope',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records an inbound email as a message', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });
    prisma.message.create.mockResolvedValue({ id: 'in1' });
    prisma.conversation.update.mockResolvedValue({});

    await service.receive(tenantId, {
      from: 'customer@corp.com',
      subject: 'Re: Hello',
      text: 'Thanks!',
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'INBOUND',
        body: 'Thanks!',
        status: MessageStatus.RECEIVED,
      }),
    });
  });

  it('scopes template deletion to the tenant', async () => {
    prisma.emailTemplate.findFirst.mockResolvedValue(null);
    await expect(
      service.removeTemplate(tenantId, 'other'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.emailTemplate.delete).not.toHaveBeenCalled();
  });
});
