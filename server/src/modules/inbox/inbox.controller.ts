import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { InboxService } from './inbox.service';
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
  constructor(private readonly inbox: InboxService) {}

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
}
