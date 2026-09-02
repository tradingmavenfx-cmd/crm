import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { TicketsService } from './tickets.service';
import {
  CreateSlaPolicyDto,
  CreateTicketDto,
  CreateTicketRuleDto,
  CsatDto,
  LinkTicketsDto,
  MergeTicketDto,
  QueryTicketsDto,
  TicketCommentDto,
  UpdateTicketDto,
} from './dto/ticket.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  // ── Tickets ──────────────────────────────────

  @Get('tickets')
  list(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryTicketsDto,
  ) {
    return this.tickets.listTickets(tenantId, query);
  }

  /** Declared before :id so it is not shadowed by it. */
  @Get('tickets/stats')
  stats(@CurrentUser('tenantId') tenantId: string) {
    return this.tickets.stats(tenantId);
  }

  @Get('tickets/:id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.tickets.getTicket(tenantId, id);
  }

  @Post('tickets')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT, Role.SALES_REP)
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateTicketDto,
  ) {
    return this.tickets.createTicket(tenantId, userId, dto);
  }

  /** Raise a ticket from an inbox thread, on any channel. */
  @Post('tickets/from-conversation/:conversationId')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT, Role.SALES_REP)
  fromConversation(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: Partial<CreateTicketDto>,
  ) {
    return this.tickets.fromConversation(tenantId, userId, conversationId, dto);
  }

  @Patch('tickets/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT, Role.SALES_REP)
  update(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.tickets.updateTicket(tenantId, id, userId, dto);
  }

  @Delete('tickets/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.tickets.removeTicket(tenantId, id);
  }

  // ── Collaboration ────────────────────────────

  @Post('tickets/:id/comments')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT, Role.SALES_REP)
  comment(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: TicketCommentDto,
  ) {
    return this.tickets.addComment(tenantId, id, userId, dto);
  }

  @Post('tickets/:id/merge')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  merge(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: MergeTicketDto,
  ) {
    return this.tickets.merge(tenantId, id, dto.intoTicketId, userId);
  }

  @Post('tickets/:id/link')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  link(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: LinkTicketsDto,
  ) {
    return this.tickets.link(tenantId, id, dto.childIds, userId);
  }

  // ── Customer satisfaction (public) ───────────

  @Public()
  @Get('csat/:token')
  csatView(@Param('token') token: string) {
    return this.tickets.csatView(token);
  }

  @Public()
  @Post('csat/:token')
  csat(@Param('token') token: string, @Body() dto: CsatDto) {
    return this.tickets.submitCsat(token, dto);
  }

  // ── SLA policies ─────────────────────────────

  @Get('sla-policies')
  listPolicies(@CurrentUser('tenantId') tenantId: string) {
    return this.tickets.listPolicies(tenantId);
  }

  @Post('sla-policies')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createPolicy(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateSlaPolicyDto,
  ) {
    return this.tickets.createPolicy(tenantId, dto);
  }

  // ── Routing rules ────────────────────────────

  @Get('ticket-rules')
  listRules(@CurrentUser('tenantId') tenantId: string) {
    return this.tickets.listRules(tenantId);
  }

  @Post('ticket-rules')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createRule(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateTicketRuleDto,
  ) {
    return this.tickets.createRule(tenantId, dto);
  }

  @Delete('ticket-rules/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeRule(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.tickets.removeRule(tenantId, id);
  }
}
