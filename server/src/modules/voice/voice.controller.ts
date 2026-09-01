import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { IvrAction } from './providers/voice-provider.interface';
import { VoiceService } from './voice.service';
import { ClickToCallDto, QueryCallsDto } from './dto/call.dto';
import { CreateIvrFlowDto, UpdateIvrFlowDto } from './dto/ivr-flow.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Telephony webhooks arrive either as Twilio's form-encoded fields or as plain
 * JSON (mock provider / tests). Accept both shapes.
 */
type WebhookBody = Record<string, string | undefined>;

const pick = (body: WebhookBody, ...keys: string[]): string =>
  keys.map((k) => body[k]).find((v) => v !== undefined && v !== '') ?? '';

@Controller('voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  // ── Click-to-call & call log ─────────────────

  @Post('calls')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT)
  call(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: ClickToCallDto,
  ) {
    return this.voice.clickToCall(tenantId, userId, dto);
  }

  @Get('calls')
  listCalls(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryCallsDto,
  ) {
    return this.voice.listCalls(tenantId, query);
  }

  @Get('analytics')
  analytics(@CurrentUser('tenantId') tenantId: string) {
    return this.voice.analytics(tenantId);
  }

  @Get('calls/:id')
  getCall(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.voice.getCall(tenantId, id);
  }

  // ── IVR flows ────────────────────────────────

  @Get('ivr-flows')
  listFlows(@CurrentUser('tenantId') tenantId: string) {
    return this.voice.listFlows(tenantId);
  }

  @Get('ivr-flows/:id')
  getFlow(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.voice.getFlow(tenantId, id);
  }

  @Post('ivr-flows')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createFlow(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateIvrFlowDto,
  ) {
    return this.voice.createFlow(tenantId, dto);
  }

  @Patch('ivr-flows/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateFlow(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateIvrFlowDto,
  ) {
    return this.voice.updateFlow(tenantId, id, dto);
  }

  @Delete('ivr-flows/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeFlow(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.voice.removeFlow(tenantId, id);
  }

  // ── Telephony webhooks (public) ──────────────

  /** Sends the rendered IVR step back in the provider's own dialect. */
  private respond(res: Response, action: IvrAction) {
    const rendered = this.voice.render(action);
    res.type(rendered.contentType).send(rendered.body);
  }

  @Public()
  @Post('webhook/:tenantId/incoming')
  async incoming(
    @Param('tenantId') tenantId: string,
    @Body() body: WebhookBody,
    @Res() res: Response,
  ) {
    const action = await this.voice.handleIncoming(tenantId, {
      from: pick(body, 'From', 'from'),
      to: pick(body, 'To', 'to'),
      externalId: pick(body, 'CallSid', 'externalId'),
    });
    this.respond(res, action);
  }

  @Public()
  @Post('webhook/:tenantId/dtmf')
  async dtmf(
    @Param('tenantId') tenantId: string,
    @Body() body: WebhookBody,
    @Res() res: Response,
  ) {
    const action = await this.voice.handleDtmf(tenantId, {
      externalId: pick(body, 'CallSid', 'externalId'),
      digits: pick(body, 'Digits', 'digits'),
    });
    this.respond(res, action);
  }

  @Public()
  @Post('webhook/:tenantId/status')
  status(@Param('tenantId') tenantId: string, @Body() body: WebhookBody) {
    const duration = pick(body, 'CallDuration', 'durationSec');
    return this.voice.handleStatus(tenantId, {
      externalId: pick(body, 'CallSid', 'externalId'),
      status: pick(body, 'CallStatus', 'status'),
      durationSec: duration ? parseInt(duration, 10) : undefined,
      recordingUrl: pick(body, 'RecordingUrl', 'recordingUrl') || undefined,
    });
  }

  @Public()
  @Post('webhook/:tenantId/recording')
  recording(@Param('tenantId') tenantId: string, @Body() body: WebhookBody) {
    const duration = pick(body, 'RecordingDuration', 'durationSec');
    return this.voice.handleRecording(tenantId, {
      externalId: pick(body, 'CallSid', 'externalId'),
      recordingUrl: pick(body, 'RecordingUrl', 'recordingUrl'),
      transcript: pick(body, 'TranscriptionText', 'transcript') || undefined,
      durationSec: duration ? parseInt(duration, 10) : undefined,
    });
  }
}
