import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignStatus, Channel } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const contact = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'c1',
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'priya@globex.in',
  phone: '+919876543210',
  score: 65,
  ...over,
});

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: any;
  let email: { send: jest.Mock };
  let sms: { send: jest.Mock };
  let whatsapp: { send: jest.Mock };
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      campaign: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
      touchpoint: { create: jest.fn().mockResolvedValue({}) },
      campaignRecipient: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        groupBy: jest.fn(),
        count: jest.fn(),
      },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
    };
    email = { send: jest.fn().mockResolvedValue({ id: 'm-email' }) };
    sms = { send: jest.fn().mockResolvedValue({ id: 'm-sms' }) };
    whatsapp = { send: jest.fn().mockResolvedValue({ id: 'm-wa' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: SmsService, useValue: sms },
        { provide: WhatsappService, useValue: whatsapp },
      ],
    }).compile();

    service = moduleRef.get(CampaignsService);
  });

  // ── Validation ─────────────────────────────────

  it('rejects an email campaign with neither subject nor template', async () => {
    await expect(
      service.createCampaign(tenantId, 'u1', {
        name: 'Blast',
        channel: Channel.EMAIL,
        body: 'hi',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a WhatsApp campaign without an approved template', async () => {
    await expect(
      service.createCampaign(tenantId, 'u1', {
        name: 'Blast',
        channel: Channel.WHATSAPP,
        body: 'hi',
      }),
    ).rejects.toThrow('approved template');
  });

  it('rejects a campaign on a channel that cannot broadcast', async () => {
    await expect(
      service.createCampaign(tenantId, 'u1', {
        name: 'Blast',
        channel: Channel.VOICE,
      }),
    ).rejects.toThrow('Cannot run a campaign on VOICE');
  });

  // ── Audience ───────────────────────────────────

  it('uses explicit contact ids ahead of filters', async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await service.audience(tenantId, { contactIds: ['a', 'b'], minScore: 90 });

    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      where: { tenantId, id: { in: ['a', 'b'] } },
    });
  });

  it('builds a filter query from the segment', async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    await service.audience(tenantId, { minScore: 50, companyId: 'co1' });

    const arg = prisma.contact.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      tenantId,
      score: { gte: 50 },
      companyId: 'co1',
    });
  });

  // ── Sending ────────────────────────────────────

  it('personalises the body per recipient and records the send', async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp1',
      tenantId,
      channel: Channel.EMAIL,
      status: CampaignStatus.DRAFT,
      subject: 'Hi {{firstName}}',
      body: 'Hello {{fullName}}, welcome.',
      templateId: null,
      whatsappTemplateName: null,
      segment: {},
    });
    prisma.contact.findMany.mockResolvedValue([contact()]);

    const result = await service.send(tenantId, 'camp1');

    expect(email.send).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        to: 'priya@globex.in',
        subject: 'Hi Priya',
        html: 'Hello Priya Sharma, welcome.',
        campaignId: 'camp1',
      }),
    );
    expect(result).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
  });

  it('skips a contact with no address for the channel', async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp1',
      tenantId,
      channel: Channel.EMAIL,
      status: CampaignStatus.DRAFT,
      subject: 'Hi',
      body: 'x',
      templateId: null,
      whatsappTemplateName: null,
      segment: {},
    });
    prisma.contact.findMany.mockResolvedValue([contact({ email: null })]);

    const result = await service.send(tenantId, 'camp1');

    expect(email.send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(prisma.campaignRecipient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'skipped',
          reason: 'no_address',
        }),
      }),
    );
  });

  it('counts an opt-out as skipped, not failed', async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp1',
      tenantId,
      channel: Channel.SMS,
      status: CampaignStatus.DRAFT,
      subject: null,
      body: 'Offer inside',
      templateId: null,
      whatsappTemplateName: null,
      segment: {},
    });
    prisma.contact.findMany.mockResolvedValue([contact()]);
    sms.send.mockRejectedValue(
      new Error('Recipient has opted out of SMS (DND) - message not sent'),
    );

    const result = await service.send(tenantId, 'camp1');

    expect(result).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(prisma.campaignRecipient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ reason: 'opted_out' }),
      }),
    );
  });

  it('records a provider error as failed and keeps going', async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp1',
      tenantId,
      channel: Channel.SMS,
      status: CampaignStatus.DRAFT,
      subject: null,
      body: 'x',
      templateId: null,
      whatsappTemplateName: null,
      segment: {},
    });
    prisma.contact.findMany.mockResolvedValue([
      contact(),
      contact({ id: 'c2', phone: '+919999999999' }),
    ]);
    sms.send
      .mockRejectedValueOnce(new Error('gateway down'))
      .mockResolvedValueOnce({ id: 'm-sms' });

    const result = await service.send(tenantId, 'camp1');

    expect(result).toMatchObject({ total: 2, sent: 1, failed: 1 });
  });

  it('sends WhatsApp broadcasts through the approved template', async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp1',
      tenantId,
      channel: Channel.WHATSAPP,
      status: CampaignStatus.DRAFT,
      subject: null,
      body: null,
      templateId: null,
      whatsappTemplateName: 'diwali_offer',
      segment: {},
    });
    prisma.contact.findMany.mockResolvedValue([contact()]);

    await service.send(tenantId, 'camp1');

    expect(whatsapp.send).toHaveBeenCalledWith(tenantId, {
      to: '+919876543210',
      templateName: 'diwali_offer',
      parameters: ['Priya'],
    });
  });

  it('refuses to send the same campaign twice', async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp1',
      tenantId,
      channel: Channel.EMAIL,
      status: CampaignStatus.COMPLETED,
      subject: 'Hi',
      segment: {},
    });

    await expect(service.send(tenantId, 'camp1')).rejects.toThrow(
      'already been sent',
    );
  });

  it('will not edit a campaign that has already run', async () => {
    prisma.campaign.findFirst.mockResolvedValue({
      id: 'camp1',
      tenantId,
      status: CampaignStatus.COMPLETED,
    });

    await expect(
      service.updateCampaign(tenantId, 'camp1', { name: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes campaign lookups to the tenant', async () => {
    prisma.campaign.findFirst.mockResolvedValue(null);
    await expect(service.getCampaign(tenantId, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
