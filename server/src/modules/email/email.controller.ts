import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { EmailService, InboundEmailDto } from './email.service';
import { SendEmailDto } from './dto/send-email.dto';
import {
  CreateEmailTemplateDto,
  UpdateEmailTemplateDto,
} from './dto/email-template.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Post('send')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT)
  send(@CurrentUser('tenantId') tenantId: string, @Body() dto: SendEmailDto) {
    return this.email.send(tenantId, dto);
  }

  /**
   * Inbound-parse webhook (e.g. SendGrid). Public; the tenant is resolved from
   * the recipient mapping. For the MVP we accept an explicit tenantId param.
   */
  @Public()
  @Post('webhook/:tenantId')
  webhook(
    @Param('tenantId') tenantId: string,
    @Body() dto: InboundEmailDto,
  ) {
    return this.email.receive(tenantId, dto);
  }

  // ── Templates ────────────────────────────────
  @Get('templates')
  listTemplates(@CurrentUser('tenantId') tenantId: string) {
    return this.email.listTemplates(tenantId);
  }

  @Post('templates')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateEmailTemplateDto,
  ) {
    return this.email.createTemplate(tenantId, dto);
  }

  @Patch('templates/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.email.updateTemplate(tenantId, id, dto);
  }

  @Delete('templates/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.email.removeTemplate(tenantId, id);
  }
}
