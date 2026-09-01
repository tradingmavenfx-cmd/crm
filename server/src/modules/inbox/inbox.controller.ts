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
import { InboxService } from './inbox.service';
import { RoutingService } from '../routing/routing.service';
import {
  CreateAssignmentRuleDto,
  UpdateAssignmentRuleDto,
} from '../routing/dto/assignment-rule.dto';
import { QueryInboxDto } from './dto/query-inbox.dto';
import { ReplyDto } from './dto/reply.dto';
import {
  CreateNoteDto,
  UpdateConversationDto,
} from './dto/update-conversation.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly routing: RoutingService,
  ) {}

  @Get('conversations')
  conversations(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryInboxDto,
  ) {
    return this.inbox.listConversations(tenantId, query);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.inbox.listMessages(tenantId, id);
  }

  @Post('conversations/:id/reply')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT)
  reply(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: ReplyDto,
  ) {
    return this.inbox.reply(tenantId, id, dto);
  }

  @Patch('conversations/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT)
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.inbox.updateConversation(tenantId, id, dto);
  }

  @Post('conversations/:id/notes')
  addNote(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.inbox.addNote(tenantId, id, userId, dto.body);
  }

  // -- @mentions --------------------------------

  @Get('mentions')
  mentions(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query('unread') unread?: string,
  ) {
    return this.inbox.listMentions(tenantId, userId, unread === 'true');
  }

  @Patch('mentions/:id/read')
  readMention(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.inbox.markMentionRead(tenantId, userId, id);
  }

  // -- Auto-assignment rules --------------------

  @Get('assignment-rules')
  rules(@CurrentUser('tenantId') tenantId: string) {
    return this.routing.listRules(tenantId);
  }

  @Post('assignment-rules')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createRule(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateAssignmentRuleDto,
  ) {
    return this.routing.createRule(tenantId, dto);
  }

  @Patch('assignment-rules/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateRule(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentRuleDto,
  ) {
    return this.routing.updateRule(tenantId, id, dto);
  }

  @Delete('assignment-rules/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeRule(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.routing.removeRule(tenantId, id);
  }
}
