import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import {
  ChatMessageDto,
  ChatPageViewDto,
  ChatPollDto,
  ChatRatingDto,
  StartChatDto,
} from './dto/chat.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly config: ConfigService,
  ) {}

  // ── Widget (public - called from the customer's own website) ──

  /** The embeddable widget, served per workspace. */
  @Public()
  @Get('chat/:tenantId/widget.js')
  widget(@Param('tenantId') tenantId: string, @Res() res: Response) {
    const apiBase = (this.config.get<string>('publicUrl') ?? '').replace(
      /\/$/,
      '',
    );
    res.set({
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=300',
    });
    res.send(this.chat.widgetScript(tenantId, apiBase));
  }

  @Public()
  @Post('chat/:tenantId/start')
  start(
    @Param('tenantId') tenantId: string,
    @Body() dto: StartChatDto,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.chat.start(tenantId, dto, userAgent);
  }

  @Public()
  @Post('chat/:tenantId/message')
  message(@Param('tenantId') tenantId: string, @Body() dto: ChatMessageDto) {
    return this.chat.sendFromVisitor(tenantId, dto);
  }

  @Public()
  @Post('chat/:tenantId/poll')
  poll(@Param('tenantId') tenantId: string, @Body() dto: ChatPollDto) {
    return this.chat.pollForVisitor(tenantId, dto.visitorKey);
  }

  @Public()
  @Post('chat/:tenantId/page')
  page(@Param('tenantId') tenantId: string, @Body() dto: ChatPageViewDto) {
    return this.chat.pageView(tenantId, dto);
  }

  @Public()
  @Post('chat/:tenantId/rate')
  rate(@Param('tenantId') tenantId: string, @Body() dto: ChatRatingDto) {
    return this.chat.rate(tenantId, dto);
  }

  // ── Agent side (authenticated) ──

  @Get('chat/visitors')
  visitors(@CurrentUser('tenantId') tenantId: string) {
    return this.chat.listVisitors(tenantId);
  }

  @Get('chat/ratings')
  ratings(@CurrentUser('tenantId') tenantId: string) {
    return this.chat.ratings(tenantId);
  }
}
