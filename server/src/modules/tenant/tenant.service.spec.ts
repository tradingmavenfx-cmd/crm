import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantSettingsService,
  brandShades,
  DEFAULT_SETTINGS,
} from './tenant-settings.service';
import { PlatformService, healthSignals } from './platform.service';

const tenantId = 'tenant-1';

const rgb = (value: string) => value.split(' ').map(Number);
const brightness = (value: string) => {
  const [r, g, b] = rgb(value);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

describe('Brand shades', () => {
  it('keeps the chosen colour as the base', () => {
    // #4f46e5 is 79, 70, 229.
    expect(brandShades('#4f46e5')[600]).toBe('79 70 229');
  });

  it('goes light, lighter, base, darker in that order', () => {
    const shades = brandShades('#4f46e5');

    expect(brightness(shades[50])).toBeGreaterThan(brightness(shades[500]));
    expect(brightness(shades[500])).toBeGreaterThan(brightness(shades[600]));
    expect(brightness(shades[600])).toBeGreaterThan(brightness(shades[700]));
  });

  it('accepts a colour with or without the hash', () => {
    expect(brandShades('4f46e5')).toEqual(brandShades('#4f46e5'));
  });

  it('falls back to the default rather than producing nonsense', () => {
    // A colour that cannot be read must not become NaN in a stylesheet.
    expect(brandShades('not-a-colour')).toEqual(
      brandShades(DEFAULT_SETTINGS.primaryColor),
    );
  });

  it('stays inside 0-255 for colours at either extreme', () => {
    for (const colour of ['#000000', '#ffffff']) {
      for (const shade of Object.values(brandShades(colour))) {
        for (const channel of rgb(shade)) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('gives white a visible dark edge to sit against', () => {
    const shades = brandShades('#ffffff');
    expect(brightness(shades[700])).toBeLessThan(brightness(shades[600]));
  });

  it('returns space-separated rgb, so opacity modifiers still work', () => {
    expect(brandShades('#4f46e5')[600]).toMatch(/^\d+ \d+ \d+$/);
  });
});

describe('Health signals', () => {
  const usage = (over: Record<string, unknown> = {}) => ({
    users: 3,
    activeUsers30d: 3,
    lastLoginAt: new Date(),
    contacts: 40,
    dealsOpen: 5,
    dealsWon90d: 2,
    failingWebhooks: 0,
    storageBytes: 0,
    ...over,
  });

  it('says nothing about a workspace that is being used', () => {
    expect(healthSignals(usage())).toHaveLength(0);
  });

  it('notices nobody has signed in for weeks', () => {
    const signals = healthSignals(
      usage({ lastLoginAt: new Date(Date.now() - 30 * 864e5) }),
    );
    expect(signals[0]).toMatchObject({ level: 'warning' });
    expect(signals[0].message).toContain('signed in');
  });

  it('notices a workspace nobody has ever opened', () => {
    expect(healthSignals(usage({ lastLoginAt: null }))[0].message).toContain(
      'ever signed in',
    );
  });

  it('notices seats being paid for and not used', () => {
    const signals = healthSignals(usage({ users: 10, activeUsers30d: 1 }));
    expect(signals.some((s) => s.message.includes('only 1'))).toBe(true);
  });

  it('does not complain about a single-person workspace', () => {
    // One person using their own workspace is not a warning sign.
    expect(healthSignals(usage({ users: 1, activeUsers30d: 1 }))).toHaveLength(
      0,
    );
  });

  it('notices contacts kept but no deals worked', () => {
    const signals = healthSignals(usage({ dealsOpen: 0, dealsWon90d: 0 }));
    expect(signals.some((s) => s.message.includes('no deals'))).toBe(true);
  });

  it('raises failing webhooks as a warning', () => {
    const signals = healthSignals(usage({ failingWebhooks: 2 }));
    expect(signals).toContainEqual({
      level: 'warning',
      message: '2 webhooks failing',
    });
  });
});

describe('TenantSettingsService', () => {
  let service: TenantSettingsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      tenantSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      tenant: { findFirst: jest.fn() },
      invoice: { findFirst: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantSettingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(TenantSettingsService);
  });

  it('falls back to sensible defaults, in rupees and Indian time', async () => {
    const settings = await service.get(tenantId);

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.timezone).toBe('Asia/Kolkata');
    expect(settings.currency).toBe('INR');
  });

  it('refuses a colour it cannot read', async () => {
    await expect(
      service.update(tenantId, { primaryColor: 'blue' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('will not let two workspaces claim the same domain', async () => {
    prisma.tenantSettings.findFirst.mockResolvedValue({ id: 'other' });

    await expect(
      service.update(tenantId, { customDomain: 'crm.acme.com' }),
    ).rejects.toThrow('already in use');
  });

  it('lets a workspace keep its own domain', async () => {
    prisma.tenantSettings.findFirst.mockResolvedValue(null);

    await service.update(tenantId, { customDomain: 'CRM.Acme.com' });

    // Stored lowercase, and the check excludes the workspace itself.
    expect(
      prisma.tenantSettings.upsert.mock.calls[0][0].update.customDomain,
    ).toBe('crm.acme.com');
    expect(prisma.tenantSettings.findFirst.mock.calls[0][0].where.NOT).toEqual({
      tenantId,
    });
  });

  // ── Branding a page nobody has signed in to ────

  it('falls back to the workspace name when nothing is branded', async () => {
    prisma.tenant.findFirst.mockResolvedValue({
      id: tenantId,
      name: 'Acme Corp',
      slug: 'acme',
      settings: null,
    });

    const branding = await service.publicBranding({ slug: 'acme' });

    expect(branding.productName).toBe('Acme Corp');
    expect(branding.shades[600]).toBe(
      brandShades(DEFAULT_SETTINGS.primaryColor)[600],
    );
  });

  it('gives a public page only what has to be on screen', async () => {
    prisma.tenant.findFirst.mockResolvedValue({
      id: tenantId,
      name: 'Acme Corp',
      slug: 'acme',
      settings: {
        productName: 'Acme Sales',
        primaryColor: '#0f766e',
        supportEmail: 'help@acme.com',
        gstin: '29ABCDE1234F1Z5',
        upiVpa: 'acme@okhdfcbank',
      },
    });

    const branding = await service.publicBranding({ slug: 'acme' });

    expect(branding.productName).toBe('Acme Sales');
    // Nothing about the workspace beyond how it looks.
    const dump = JSON.stringify(branding);
    expect(dump).not.toContain('help@acme.com');
    expect(dump).not.toContain('29ABCDE1234F1Z5');
    expect(dump).not.toContain('okhdfcbank');
  });

  it('finds a workspace by its custom domain', async () => {
    prisma.tenant.findFirst.mockResolvedValue({
      id: tenantId,
      name: 'Acme',
      slug: 'acme',
      settings: null,
    });

    await service.publicBranding({ domain: 'CRM.Acme.com' });

    expect(prisma.tenant.findFirst.mock.calls[0][0].where).toEqual({
      settings: { customDomain: 'crm.acme.com' },
    });
  });

  it('a workspace nobody can find is a 404', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);

    await expect(
      service.publicBranding({ slug: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── UPI ────────────────────────────────────────

  it('will not ask for money before somebody says where it goes', async () => {
    await expect(service.upiLinkFor(tenantId, 'i1')).rejects.toThrow(
      'Add a UPI id',
    );
  });

  it('builds a payment request any banking app understands', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      upiVpa: 'acme@okhdfcbank',
      upiName: 'Acme Corp',
    });
    prisma.invoice.findFirst.mockResolvedValue({
      number: 'INV-2026-0001',
      total: '56640.5',
      currency: 'INR',
      status: 'ISSUED',
    });

    const link = await service.upiLinkFor(tenantId, 'i1');

    expect(link.uri).toContain('upi://pay?');
    expect(link.uri).toContain('pa=acme%40okhdfcbank');
    // Two decimal places, as the spec wants.
    expect(link.uri).toContain('am=56640.50');
    expect(link.uri).toContain('cu=INR');
    expect(link.uri).toContain('INV-2026-0001');
  });

  it('refuses a currency UPI cannot carry', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      upiVpa: 'acme@okhdfcbank',
    });
    prisma.invoice.findFirst.mockResolvedValue({
      number: 'INV-1',
      total: '100',
      currency: 'USD',
      status: 'ISSUED',
    });

    await expect(service.upiLinkFor(tenantId, 'i1')).rejects.toThrow('rupee');
  });
});

describe('PlatformService', () => {
  let service: PlatformService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      tenant: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
      deal: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
      },
      document: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      webhook: { count: jest.fn().mockResolvedValue(0) },
      apiKey: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      message: { count: jest.fn().mockResolvedValue(0) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(PlatformService);
  });

  it('reports every workspace with its numbers and its signals', async () => {
    prisma.tenant.findMany.mockResolvedValue([
      {
        id: 't1',
        name: 'Acme',
        slug: 'acme',
        plan: 'free',
        isActive: true,
        createdAt: new Date(),
        settings: null,
        _count: {
          users: 2,
          contacts: 0,
          companies: 0,
          deals: 0,
          tickets: 0,
          documents: 0,
        },
      },
    ]);

    const [row] = await service.tenants();

    expect(row.usage.users).toBe(2);
    expect(row.signals.some((s) => s.message.includes('No contacts'))).toBe(
      true,
    );
  });

  it('suspends without deleting anything', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });

    await service.setActive('t1', false);

    expect(prisma.tenant.update.mock.calls[0][0].data).toEqual({
      isActive: false,
    });
  });

  it('says so when there is no such workspace', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(service.setActive('nope', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
