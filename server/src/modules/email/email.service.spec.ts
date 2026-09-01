import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { EmailService } from './email.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from './providers/email-provider.interface';
import { TrackingService } from '../tracking/tracking.service';
import { RoutingService } from '../routing/routing.service';

describe('EmailService', () => {
  let service: EmailService;
  let prisma: any;
  let provider: jest.Mocked<EmailProvider>;
  let tracking: { instrumentHtml: jest.Mock };
  let routing: { autoAssign: jest.Mock };
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      conversation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      contact: { findFirst: jest.fn() },
      message: {
        create: jest.fn().mockResolvedValue({ id: 'm1' }),
        update: jest.fn().mockResolvedValue({ id: 'm1' }),
      },
      emailTemplate: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    provider = { send: jest.fn().mockResolvedValue({ externalId: 'smtp-1' }) };
    // Tracking is exercised in its own spec; here it passes the body through.
    tracking = {
      instrumentHtml: jest.fn((_t: string, _m: string, html: string) =>
        Promise.resolve(html),
      ),
    };
    routing = { autoAssign: jest.fn().mockResolvedValue(null) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: PrismaService, useValue: prisma },
        { provide: EMAIL_PROVIDER, useValue: provider },
        { provide: TrackingService, useValue: tracking },
        { provide: RoutingService, useValue: routing },
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
    // The row is created before the send so tracking links can carry its id,
    // then flipped to SENT once the provider accepts it.
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        status: MessageStatus.QUEUED,
      }),
    });
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { externalId: 'smtp-1', status: MessageStatus.SENT },
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
