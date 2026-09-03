import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../prisma/tenant-context';
import { UpdateTenantSettingsDto } from './dto/tenant.dto';

/** What a workspace looks like before anybody changes anything. */
export const DEFAULT_SETTINGS = {
  productName: null as string | null,
  logoUrl: null as string | null,
  primaryColor: '#4f46e5',
  loginHeadline: null as string | null,
  loginSubtext: null as string | null,
  supportEmail: null as string | null,
  customDomain: null as string | null,
  showPoweredBy: true,
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  locale: 'en-IN',
  gstin: null as string | null,
  upiVpa: null as string | null,
  upiName: null as string | null,
};

export interface BrandShades {
  50: string;
  500: string;
  600: string;
  700: string;
}

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const toRgb = (rgb: [number, number, number]) => rgb.map(clamp).join(' ');

/**
 * The four shades the interface uses, from the one colour somebody picked.
 *
 * Asking a customer for four related colours is asking them to do design; a
 * tint and two shades of their own colour is what they actually mean by "our
 * brand colour". Returned as space-separated RGB so the values can go straight
 * into a CSS variable and still work with Tailwind's opacity modifiers.
 */
export function brandShades(hex: string): BrandShades {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_SETTINGS.primaryColor)!;

  const mixWithWhite = (amount: number): [number, number, number] => [
    rgb[0] + (255 - rgb[0]) * amount,
    rgb[1] + (255 - rgb[1]) * amount,
    rgb[2] + (255 - rgb[2]) * amount,
  ];
  const darken = (amount: number): [number, number, number] => [
    rgb[0] * (1 - amount),
    rgb[1] * (1 - amount),
    rgb[2] * (1 - amount),
  ];

  return {
    50: toRgb(mixWithWhite(0.92)),
    500: toRgb(mixWithWhite(0.12)),
    600: toRgb(rgb),
    700: toRgb(darken(0.16)),
  };
}

@Injectable()
export class TenantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string) {
    const row = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });
    if (!row) return { ...DEFAULT_SETTINGS };

    const { id, tenantId: _tenantId, createdAt, updatedAt, ...settings } = row;
    void id;
    void _tenantId;
    void createdAt;
    void updatedAt;
    return settings;
  }

  async update(tenantId: string, dto: UpdateTenantSettingsDto) {
    if (dto.primaryColor && !parseHex(dto.primaryColor)) {
      throw new BadRequestException(
        'The brand colour has to be a six-digit hex value, like #4f46e5',
      );
    }

    const domain = dto.customDomain?.trim().toLowerCase() || null;
    if (domain) {
      // Unique across the platform: two workspaces cannot both answer for the
      // same hostname, and finding out at request time would be far too late.
      const taken = await TenantContext.asSystem(
        'checking a custom domain is free',
        () =>
          this.prisma.tenantSettings.findFirst({
            where: { customDomain: domain, NOT: { tenantId } },
            select: { id: true },
          }),
      );
      if (taken) {
        throw new BadRequestException('That domain is already in use');
      }
    }

    await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      update: { ...dto, customDomain: domain },
      create: { tenantId, ...dto, customDomain: domain },
    });

    return this.get(tenantId);
  }

  /**
   * What a page needs before anybody has signed in.
   *
   * Public, so it carries only what has to be on screen — no support email, no
   * payment details, nothing about the workspace beyond how it looks.
   */
  async publicBranding(by: { slug?: string; domain?: string }) {
    const tenant = await TenantContext.asSystem(
      'branding a page nobody has signed in to yet',
      () =>
        this.prisma.tenant.findFirst({
          where: by.domain
            ? { settings: { customDomain: by.domain.toLowerCase() } }
            : { slug: by.slug ?? '' },
          select: { id: true, name: true, slug: true, settings: true },
        }),
    );
    if (!tenant) throw new NotFoundException('Workspace not found');

    const settings = tenant.settings;
    const primaryColor =
      settings?.primaryColor ?? DEFAULT_SETTINGS.primaryColor;

    return {
      tenantSlug: tenant.slug,
      productName: settings?.productName ?? tenant.name,
      logoUrl: settings?.logoUrl ?? null,
      primaryColor,
      shades: brandShades(primaryColor),
      loginHeadline: settings?.loginHeadline ?? null,
      loginSubtext: settings?.loginSubtext ?? null,
      showPoweredBy: settings?.showPoweredBy ?? true,
      locale: settings?.locale ?? DEFAULT_SETTINGS.locale,
    };
  }

  /**
   * A UPI payment request for an invoice.
   *
   * Built to the UPI deep-link spec, so any Indian banking app opens it and no
   * payment provider sits in the middle. It asks for money; it does not know
   * whether the money arrived — that needs a provider, and is not pretended
   * here.
   */
  async upiLinkFor(tenantId: string, invoiceId: string) {
    const settings = await this.get(tenantId);
    if (!settings.upiVpa) {
      throw new BadRequestException(
        'Add a UPI id in settings before asking to be paid by UPI',
      );
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      select: { number: true, total: true, currency: true, status: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.currency !== 'INR') {
      throw new BadRequestException('UPI can only be used for rupee invoices');
    }

    const params = new URLSearchParams({
      pa: settings.upiVpa,
      pn: settings.upiName ?? settings.productName ?? 'Payee',
      am: Number(invoice.total).toFixed(2),
      cu: 'INR',
      tn: `Invoice ${invoice.number}`,
    });

    return {
      invoice: invoice.number,
      amount: Number(invoice.total),
      payee: settings.upiVpa,
      // Rendered as a QR code by the client; there is nothing to call.
      uri: `upi://pay?${params.toString()}`,
      paid: invoice.status === 'PAID',
    };
  }
}
