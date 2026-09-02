import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PortalGuard } from './portal.guard';
import { Portal, PortalToken } from './portal.decorator';
import { PortalContext, PortalService } from './portal.service';
import {
  PortalCommentDto,
  PortalTicketDto,
  RequestLinkDto,
  StartSessionDto,
} from './dto/portal.dto';

/**
 * The customer portal. Every route is @Public() as far as the staff JWT guard
 * is concerned; the signed-in routes are guarded by the portal session
 * instead, which resolves to a contact rather than a CRM user.
 */
@ApiTags('portal')
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  // ── Signing in ───────────────────────────────

  @Public()
  @Post(':tenantId/request-link')
  @HttpCode(200)
  requestLink(
    @Param('tenantId') tenantId: string,
    @Body() dto: RequestLinkDto,
  ) {
    return this.portal.requestLink(tenantId, dto);
  }

  @Public()
  @Post(':tenantId/session')
  @HttpCode(200)
  startSession(
    @Param('tenantId') tenantId: string,
    @Body() dto: StartSessionDto,
  ) {
    return this.portal.startSession(tenantId, dto.token);
  }

  @Public()
  @UseGuards(PortalGuard)
  @Post('logout')
  @HttpCode(200)
  logout(@PortalToken() token: string) {
    return this.portal.endSession(token);
  }

  // ── Signed in ────────────────────────────────

  @Public()
  @UseGuards(PortalGuard)
  @Get('me')
  me(@Portal() ctx: PortalContext) {
    return this.portal.me(ctx);
  }

  @Public()
  @UseGuards(PortalGuard)
  @Get('tickets')
  listTickets(@Portal() ctx: PortalContext) {
    return this.portal.listTickets(ctx);
  }

  @Public()
  @UseGuards(PortalGuard)
  @Get('tickets/:id')
  getTicket(@Portal() ctx: PortalContext, @Param('id') id: string) {
    return this.portal.getTicket(ctx, id);
  }

  @Public()
  @UseGuards(PortalGuard)
  @Post('tickets')
  createTicket(@Portal() ctx: PortalContext, @Body() dto: PortalTicketDto) {
    return this.portal.createTicket(ctx, dto);
  }

  @Public()
  @UseGuards(PortalGuard)
  @Post('tickets/:id/comments')
  reply(
    @Portal() ctx: PortalContext,
    @Param('id') id: string,
    @Body() dto: PortalCommentDto,
  ) {
    return this.portal.replyToTicket(ctx, id, dto);
  }

  @Public()
  @UseGuards(PortalGuard)
  @Get('quotes')
  quotes(@Portal() ctx: PortalContext) {
    return this.portal.listQuotes(ctx);
  }

  @Public()
  @UseGuards(PortalGuard)
  @Get('invoices')
  invoices(@Portal() ctx: PortalContext) {
    return this.portal.listInvoices(ctx);
  }
}
