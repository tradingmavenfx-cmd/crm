import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { SmsService } from './sms.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from './providers/sms-provider.interface';

describe('SmsService', () => {
  let service: SmsService;
  let prisma: any;
  let provider: jest.Mocked<SmsProvider>;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      conversation: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'conv1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
      message: {
        create: jest.fn().mockResolvedValue({ id: 'm1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      smsTemplate: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      smsOptOut: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'o1' }),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      smsOtp: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'otp1' }),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    provider = { send: jest.fn().mockResolvedValue({ externalId: 'SM123' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SMS_PROVIDER, useValue: provider },
      ],
    }).compile();

    service = moduleRef.get(SmsService);
  });

  it('sends an SMS and threads it into a normalized conversation', async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', phone: '+91-98765 43210' },
    ]);

    await service.send(tenantId, { to: '+91-9876543210', text: 'Hi there' });

    // The dashed contact number still matches the dial-format recipient.
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: '+919876543210',
        channel: 'SMS',
        contactId: 'c1',
      }),
    });
    expect(provider.send).toHaveBeenCalledWith({
      to: '+91-9876543210',
      text: 'Hi there',
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'OUTBOUND',
        channel: 'SMS',
        status: MessageStatus.SENT,
      }),
    });
  });

  it('adopts a contact onto a thread that pre-dates it', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv1',
      contactId: null,
    });
    prisma.conversation.update.mockResolvedValue({
      id: 'conv1',
      contactId: 'c1',
    });
    prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', phone: '+919876543210' },
    ]);

    await service.send(tenantId, { to: '+919876543210', text: 'Hi' });

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { contactId: 'c1' },
    });
  });

  it('does not re-scan contacts for a thread that already has one', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv1',
      contactId: 'c1',
    });

    await service.send(tenantId, { to: '+919876543210', text: 'Hi' });

    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it('refuses to send to an opted-out number (DND)', async () => {
    prisma.smsOptOut.findUnique.mockResolvedValue({ id: 'o1' });

    await expect(
      service.send(tenantId, { to: '+919876543210', text: 'promo' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('renders template merge fields', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });
    prisma.smsTemplate.findFirst.mockResolvedValue({
      id: 'tpl1',
      body: 'Hi {{name}}, your order {{order}} shipped.',
    });

    await service.send(tenantId, {
      to: '+919876543210',
      templateId: 'tpl1',
      variables: { name: 'Priya', order: 'A-42' },
    });

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hi Priya, your order A-42 shipped.' }),
    );
  });

  it('leaves unknown merge fields untouched', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });

    await service.send(tenantId, {
      to: '+919876543210',
      text: 'Hi {{name}}, ref {{missing}}',
      variables: { name: 'Priya' },
    });

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hi Priya, ref {{missing}}' }),
    );
  });

  it('throws when the template is missing', async () => {
    prisma.smsTemplate.findFirst.mockResolvedValue(null);
    await expect(
      service.send(tenantId, { to: '+919876543210', templateId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('opts a number out when an inbound STOP arrives', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });

    await service.receive(tenantId, { from: '+91 98765 43210', text: 'STOP' });

    expect(prisma.smsOptOut.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          tenantId,
          phone: '+919876543210',
          reason: 'stop_keyword',
        },
      }),
    );
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'INBOUND',
        status: MessageStatus.RECEIVED,
      }),
    });
  });

  it('opts a number back in on START', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });

    await service.receive(tenantId, { from: '+919876543210', text: 'start' });

    expect(prisma.smsOptOut.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, phone: '+919876543210' },
    });
    expect(prisma.smsOptOut.upsert).not.toHaveBeenCalled();
  });

  it('does not treat an ordinary reply as an opt-out', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });

    await service.receive(tenantId, {
      from: '+919876543210',
      text: 'please stop by tomorrow',
    });

    expect(prisma.smsOptOut.upsert).not.toHaveBeenCalled();
  });

  it('skips opted-out numbers in a bulk send instead of failing the batch', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv1' });
    prisma.smsOptOut.findUnique.mockImplementation(({ where }: any) =>
      where.tenantId_phone.phone === '+919999999999' ? { id: 'o1' } : null,
    );

    const result = await service.sendBulk(tenantId, {
      to: ['+919876543210', '+919999999999'],
      text: 'Diwali offer inside',
    });

    expect(result).toMatchObject({ total: 2, sent: 1, skipped: 1, failed: 0 });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('maps provider delivery statuses onto the message', async () => {
    await service.updateStatus({ externalId: 'SM123', status: 'delivered' });

    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { externalId: 'SM123' },
      data: { status: MessageStatus.DELIVERED },
    });
  });

  it('ignores an unrecognised delivery status', async () => {
    const res = await service.updateStatus({
      externalId: 'SM123',
      status: 'accepted',
    });
    expect(res).toEqual({ updated: 0 });
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
  });

  it('sends an OTP without storing the plaintext code', async () => {
    await service.sendOtp(tenantId, '+91 98765 43210');

    const stored = prisma.smsOtp.create.mock.calls[0][0].data;
    const sentText = provider.send.mock.calls[0][0].text;
    const code = sentText.match(/\d{6}/)![0];

    expect(stored.phone).toBe('+919876543210');
    expect(stored.codeHash).not.toContain(code);
  });

  it('verifies a correct OTP once and rejects a wrong one', async () => {
    await service.sendOtp(tenantId, '+919876543210');
    const { codeHash } = prisma.smsOtp.create.mock.calls[0][0].data;
    const code = provider.send.mock.calls[0][0].text.match(/\d{6}/)![0];

    prisma.smsOtp.findFirst.mockResolvedValue({
      id: 'otp1',
      codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      consumedAt: null,
    });

    await expect(
      service.verifyOtp(tenantId, '+919876543210', '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.verifyOtp(tenantId, '+919876543210', code),
    ).resolves.toEqual({ verified: true });

    expect(prisma.smsOtp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects an expired OTP', async () => {
    prisma.smsOtp.findFirst.mockResolvedValue({
      id: 'otp1',
      codeHash: 'x',
      expiresAt: new Date(Date.now() - 1000),
      attempts: 0,
      consumedAt: null,
    });

    await expect(
      service.verifyOtp(tenantId, '+919876543210', '123456'),
    ).rejects.toThrow('Verification code expired');
  });

  it('locks out after too many OTP attempts', async () => {
    prisma.smsOtp.findFirst.mockResolvedValue({
      id: 'otp1',
      codeHash: 'x',
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 5,
      consumedAt: null,
    });

    await expect(
      service.verifyOtp(tenantId, '+919876543210', '123456'),
    ).rejects.toThrow('Too many attempts - request a new code');
  });

  it('scopes template deletion to the tenant', async () => {
    prisma.smsTemplate.findFirst.mockResolvedValue(null);
    await expect(
      service.removeTemplate(tenantId, 'other'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.smsTemplate.delete).not.toHaveBeenCalled();
  });
});
