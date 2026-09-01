import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { PrismaService } from '../../prisma/prisma.service';

const CONFIG: Record<string, unknown> = {
  publicUrl: 'http://localhost:4000/api',
  'tracking.enabled': true,
};

describe('TrackingService', () => {
  let service: TrackingService;
  let prisma: any;
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = {
      shortLink: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      message: {
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      emailEvent: {
        create: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      campaignRecipient: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => CONFIG[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(TrackingService);
  });

  it('rewrites links and appends the open pixel', async () => {
    const html =
      '<p>Hi <a href="https://acme.test/pricing">see pricing</a></p>';

    const out = await service.instrumentHtml(tenantId, 'm1', html);

    expect(out).not.toContain('href="https://acme.test/pricing"');
    expect(out).toContain('/track/click/');
    expect(out).toContain('/track/open/m1.gif');
    expect(prisma.shortLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        url: 'https://acme.test/pricing',
        messageId: 'm1',
      }),
    });
  });

  it('shortens bare URLs in plain text', async () => {
    const out = await service.instrumentText(
      tenantId,
      'Pay at https://pay.test/x now',
    );

    expect(out).toContain('/track/click/');
    expect(out).not.toContain('https://pay.test/x');
  });

  it('does not re-shorten an already tracked link', async () => {
    const out = await service.instrumentText(
      tenantId,
      'Open http://localhost:4000/api/track/click/abc',
    );

    expect(prisma.shortLink.create).not.toHaveBeenCalled();
    expect(out).toContain('/track/click/abc');
  });

  it('leaves the body untouched when tracking is off', async () => {
    CONFIG['tracking.enabled'] = false;
    const html = '<a href="https://acme.test">x</a>';

    const out = await service.instrumentHtml(tenantId, 'm1', html);

    expect(out).toBe(html);
    CONFIG['tracking.enabled'] = true;
  });

  it('records an open and stamps the campaign recipient', async () => {
    prisma.message.findUnique.mockResolvedValue({ id: 'm1', tenantId });

    await service.recordOpen('m1', 'Mozilla/5.0');

    expect(prisma.emailEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'open', messageId: 'm1' }),
    });
    expect(prisma.campaignRecipient.updateMany).toHaveBeenCalledWith({
      where: { messageId: 'm1', openedAt: null },
      data: { openedAt: expect.any(Date) },
    });
  });

  it('ignores an open for an unknown message rather than failing the pixel', async () => {
    prisma.message.findUnique.mockResolvedValue(null);

    await expect(service.recordOpen('gone')).resolves.toBeUndefined();
    expect(prisma.emailEvent.create).not.toHaveBeenCalled();
  });

  it('counts a click and returns the destination', async () => {
    prisma.shortLink.findUnique.mockResolvedValue({
      id: 'l1',
      tenantId,
      url: 'https://acme.test/pricing',
      messageId: 'm1',
    });

    const url = await service.resolveClick('abc', 'Mozilla/5.0');

    expect(url).toBe('https://acme.test/pricing');
    expect(prisma.shortLink.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { clicks: { increment: 1 } },
    });
    expect(prisma.emailEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'click' }),
    });
  });

  it('throws on an unknown short link', async () => {
    prisma.shortLink.findUnique.mockResolvedValue(null);
    await expect(service.resolveClick('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports open and click rates against sent mail', async () => {
    prisma.message.count.mockResolvedValue(10);
    prisma.emailEvent.groupBy
      .mockResolvedValueOnce([{ messageId: 'a' }, { messageId: 'b' }])
      .mockResolvedValueOnce([{ messageId: 'a' }]);

    const stats = await service.stats(tenantId);

    expect(stats).toMatchObject({
      sent: 10,
      uniqueOpens: 2,
      uniqueClicks: 1,
      openRate: 20,
      clickRate: 10,
    });
  });
});
