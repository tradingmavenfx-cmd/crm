import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { AiService } from './ai.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

export class AskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question!: string;
}

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  // ── Scoring & prediction ─────────────────────

  @Post('score/contact/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  scoreContact(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.ai.scoreContact(tenantId, id);
  }

  @Get('scoreboard')
  scoreboard(@CurrentUser('tenantId') tenantId: string) {
    return this.ai.scoreboard(tenantId);
  }

  @Post('predict/deal/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  predictDeal(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.ai.predictDeal(tenantId, id);
  }

  @Get('deals/at-risk')
  atRisk(@CurrentUser('tenantId') tenantId: string) {
    return this.ai.atRiskDeals(tenantId);
  }

  // ── Coaching ─────────────────────────────────

  @Get('coach/contact/:id')
  coach(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.ai.coach(tenantId, id);
  }

  // ── Conversation intelligence ────────────────

  @Post('sentiment/conversation/:id')
  sentiment(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.ai.sentiment(tenantId, id);
  }

  /** Returns a draft for the agent to edit; nothing is sent. */
  @Post('suggest-reply/conversation/:id')
  suggestReply(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.ai.suggestReply(tenantId, id);
  }

  /** Structured fields pulled from a thread, for review before saving. */
  @Post('extract/conversation/:id')
  extract(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.ai.extract(tenantId, id);
  }

  // ── Assistants ───────────────────────────────

  @Get('research/contact/:id')
  research(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.ai.research(tenantId, id);
  }

  /** Natural-language question, answered from the report catalogue. */
  @Post('ask')
  ask(@CurrentUser('tenantId') tenantId: string, @Body() dto: AskDto) {
    return this.ai.ask_question(tenantId, dto.question);
  }

  // ── History ──────────────────────────────────

  @Get('insights/:entityType/:entityId')
  insights(
    @CurrentUser('tenantId') tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.ai.listInsights(tenantId, entityType, entityId);
  }
}
