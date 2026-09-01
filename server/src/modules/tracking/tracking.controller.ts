import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TRACKING_PIXEL, TrackingService } from './tracking.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller()
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /**
   * Open-tracking pixel. Always returns the image, even for an unknown id -
   * a broken image in someone's inbox would be worse than a missed metric.
   */
  @Public()
  @Get('track/open/:messageId.gif')
  async open(
    @Param('messageId') messageId: string,
    @Headers('user-agent') userAgent: string,
    @Res() res: Response,
  ) {
    await this.tracking.recordOpen(messageId, userAgent);
    res.set({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    });
    res.send(TRACKING_PIXEL);
  }

  /** Click tracking: counts the click, then redirects to the real URL. */
  @Public()
  @Get('track/click/:code')
  async click(
    @Param('code') code: string,
    @Headers('user-agent') userAgent: string,
    @Res() res: Response,
  ) {
    const url = await this.tracking.resolveClick(code, userAgent);
    res.redirect(302, url);
  }

  @Get('tracking/stats')
  stats(@CurrentUser('tenantId') tenantId: string) {
    return this.tracking.stats(tenantId);
  }
}
