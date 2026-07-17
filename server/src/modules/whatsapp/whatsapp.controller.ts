import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { WhatsappService, WebhookPayload } from './whatsapp.service';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { CreateNoteDto } from './dto/note.dto';
import {
  CreateCannedResponseDto,
  UpdateCannedResponseDto,
} from './dto/canned-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService,
  ) {}

  /** Meta webhook verification handshake (GET). Must echo hub.challenge. */
  @Public()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const expected = this.config.get<string>('whatsapp.verifyToken');
    if (mode === 'subscribe' && token === expected) {
      return challenge;
    }
    throw new ForbiddenException('Verification failed');
  }

  /** Inbound messages + status callbacks (POST). */
  @Public()
  @Post('webhook')
  async webhook(@Body() payload: WebhookPayload) {
    await this.whatsapp.handleWebhook(payload);
    return { received: true };
  }

  @Post('send')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT)
  send(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: SendMessageDto,
  ) {
    if (!dto.text && !dto.templateName) {
      throw new BadRequestException('Either text or templateName is required');
    }
    return this.whatsapp.send(tenantId, dto);
  }

  @Get('conversations')
  conversations(@CurrentUser('tenantId') tenantId: string) {
    return this.whatsapp.listConversations(tenantId);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.whatsapp.listMessages(tenantId, id);
  }

  /** Assign/transfer to an agent and/or change status. */
  @Patch('conversations/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT, Role.SALES_REP)
  updateConversation(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.whatsapp.updateConversation(tenantId, id, dto);
  }

  /** Add an internal (agent-only) note to a conversation. */
  @Post('conversations/:id/notes')
  addNote(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.whatsapp.addNote(tenantId, id, userId, dto.body);
  }

  // ── Canned responses ─────────────────────────
  @Get('canned-responses')
  listCanned(@CurrentUser('tenantId') tenantId: string) {
    return this.whatsapp.listCanned(tenantId);
  }

  @Post('canned-responses')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createCanned(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateCannedResponseDto,
  ) {
    return this.whatsapp.createCanned(tenantId, dto);
  }

  @Patch('canned-responses/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateCanned(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCannedResponseDto,
  ) {
    return this.whatsapp.updateCanned(tenantId, id, dto);
  }

  @Delete('canned-responses/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeCanned(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.whatsapp.removeCanned(tenantId, id);
  }
}
