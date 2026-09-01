import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { InboxService } from './inbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';

describe('InboxService', () => {
  let service: InboxService;
  let prisma: any;
  let whatsapp: { send: jest.Mock };
  let email: { send: jest.Mock };
  let sms: { send: jest.Mock };
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      conversation: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      message: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    };
    whatsapp = { send: jest.fn().mockResolvedValue({ id: 'wa-msg' }) };
    email = { send: jest.fn().mockResolvedValue({ id: 'em-msg' }) };
    sms = { send: jest.fn().mockResolvedValue({ id: 'sms-msg' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InboxService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: EmailService, useValue: email },
        { provide: SmsService, useValue: sms },
      ],
    }).compile();

    service = moduleRef.get(InboxService);
  });

  it('routes a reply on a WhatsApp conversation to the WhatsApp service', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId,
      channel: Channel.WHATSAPP,
      externalId: '+919812345678',
    });

    await service.reply(tenantId, 'c1', { text: 'Hi there' });

    expect(whatsapp.send).toHaveBeenCalledWith(tenantId, {
      to: '+919812345678',
      text: 'Hi there',
    });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('routes a reply on an Email conversation to the Email service with a Re: subject', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'c2',
      tenantId,
      channel: Channel.EMAIL,
      externalId: 'lead@example.com',
    });
    prisma.message.findFirst.mockResolvedValue({ subject: 'Welcome' });

    await service.reply(tenantId, 'c2', { text: 'Thanks for your email' });

    expect(email.send).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        to: 'lead@example.com',
        subject: 'Re: Welcome',
        text: 'Thanks for your email',
      }),
    );
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it('does not double-prefix an already Re: subject', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'c3',
      tenantId,
      channel: Channel.EMAIL,
      externalId: 'x@y.com',
    });
    prisma.message.findFirst.mockResolvedValue({ subject: 'Re: Order #5' });

    await service.reply(tenantId, 'c3', { text: 'ok' });

    const arg = email.send.mock.calls[0][1];
    expect(arg.subject).toBe('Re: Order #5');
  });

  it('routes a reply on an SMS conversation to the SMS service', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'c4',
      tenantId,
      channel: Channel.SMS,
      externalId: '+919812345678',
    });

    await service.reply(tenantId, 'c4', { text: 'Your order shipped' });

    expect(sms.send).toHaveBeenCalledWith(tenantId, {
      to: '+919812345678',
      text: 'Your order shipped',
    });
    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('rejects a text reply on a voice conversation', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'c5',
      tenantId,
      channel: Channel.VOICE,
      externalId: '+919812345678',
    });

    await expect(
      service.reply(tenantId, 'c5', { text: 'hi' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('throws NotFound replying to a conversation outside the tenant', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(
      service.reply(tenantId, 'missing', { text: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters conversations by channel', async () => {
    prisma.conversation.findMany.mockResolvedValue([]);
    await service.listConversations(tenantId, { channel: Channel.EMAIL });
    const arg = prisma.conversation.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId, channel: Channel.EMAIL });
  });
});
