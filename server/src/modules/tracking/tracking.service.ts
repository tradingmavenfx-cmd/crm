import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/** 1x1 transparent GIF returned by the open-tracking endpoint. */
export const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

@Injectable()
export class TrackingService {
  private readonly logger = new Logger('TrackingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return (this.config.get<string>('publicUrl') ?? '').replace(/\/$/, '');
  }

  private async shortLinkFor(
    tenantId: string,
    url: string,
    refs: { messageId?: string; campaignId?: string },
  ): Promise<string> {
    const code = randomBytes(5).toString('base64url');
    await this.prisma.shortLink.create({
      data: { tenantId, code, url, ...refs },
    });
    return `${this.baseUrl}/track/click/${code}`;
  }

  /**
   * Rewrites links in an HTML body to trackable ones and appends the open
   * pixel. Returns the body unchanged when tracking is disabled.
   */
  async instrumentHtml(
    tenantId: string,
    messageId: string,
    html: string,
    campaignId?: string,
  ): Promise<string> {
    if (!this.config.get<boolean>('tracking.enabled')) return html;

    let out = html;
    const hrefs = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/g)];
    for (const [, url] of hrefs) {
      const tracked = await this.shortLinkFor(tenantId, url, {
        messageId,
        campaignId,
      });
      out = out.replace(url, tracked);
    }

    const pixel = `<img src="${this.baseUrl}/track/open/${messageId}.gif" width="1" height="1" alt="" style="display:none" />`;
    return `${out}${pixel}`;
  }

  /** Replaces bare URLs in a plain-text body (SMS) with trackable short links. */
  async instrumentText(
    tenantId: string,
    text: string,
    refs: { messageId?: string; campaignId?: string } = {},
  ): Promise<string> {
    if (!this.config.get<boolean>('tracking.enabled')) return text;

    let out = text;
    for (const url of text.match(URL_RE) ?? []) {
      // Don't rewrite a link we already shortened.
      if (url.startsWith(`${this.baseUrl}/track/`)) continue;
      out = out.replace(url, await this.shortLinkFor(tenantId, url, refs));
    }
    return out;
  }

  /** Records an email open. Unknown ids are ignored - the pixel must not 404. */
  async recordOpen(messageId: string, userAgent?: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, tenantId: true },
    });
    if (!message) return;

    await this.prisma.emailEvent.create({
      data: {
        tenantId: message.tenantId,
        messageId: message.id,
        type: 'open',
        userAgent,
      },
    });

    // First open also lands on the campaign recipient, for campaign stats.
    await this.prisma.campaignRecipient.updateMany({
      where: { messageId: message.id, openedAt: null },
      data: { openedAt: new Date() },
    });
  }

  /** Resolves a short link, counts the click, and returns the destination. */
  async resolveClick(code: string, userAgent?: string): Promise<string> {
    const link = await this.prisma.shortLink.findUnique({ where: { code } });
    if (!link) throw new NotFoundException('Link not found');

    await this.prisma.shortLink.update({
      where: { id: link.id },
      data: { clicks: { increment: 1 } },
    });

    if (link.messageId) {
      await this.prisma.emailEvent.create({
        data: {
          tenantId: link.tenantId,
          messageId: link.messageId,
          type: 'click',
          url: link.url,
          userAgent,
        },
      });
      await this.prisma.campaignRecipient.updateMany({
        where: { messageId: link.messageId, clickedAt: null },
        data: { clickedAt: new Date() },
      });
    }

    return link.url;
  }

  /** Opens/clicks for the email analytics dashboard. */
  async stats(tenantId: string) {
    const [sent, opens, clicks, topLinks] = await Promise.all([
      this.prisma.message.count({
        where: { tenantId, channel: 'EMAIL', direction: 'OUTBOUND' },
      }),
      this.prisma.emailEvent.groupBy({
        by: ['messageId'],
        where: { tenantId, type: 'open' },
      }),
      this.prisma.emailEvent.groupBy({
        by: ['messageId'],
        where: { tenantId, type: 'click' },
      }),
      this.prisma.shortLink.findMany({
        where: { tenantId, clicks: { gt: 0 } },
        orderBy: { clicks: 'desc' },
        take: 10,
        select: { url: true, clicks: true },
      }),
    ]);

    const uniqueOpens = opens.length;
    const uniqueClicks = clicks.length;

    return {
      sent,
      uniqueOpens,
      uniqueClicks,
      openRate: sent ? Math.round((uniqueOpens / sent) * 100) : 0,
      clickRate: sent ? Math.round((uniqueClicks / sent) * 100) : 0,
      topLinks,
    };
  }
}
