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
import { InboundSmsDto, SmsService, SmsStatusDto } from './sms.service';
import { SendBulkSmsDto, SendSmsDto } from './dto/send-sms.dto';
import {
  CreateSmsTemplateDto,
  UpdateSmsTemplateDto,
} from './dto/sms-template.dto';
import { CreateOptOutDto } from './dto/opt-out.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('sms')
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  @Post('send')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT)
  send(@CurrentUser('tenantId') tenantId: string, @Body() dto: SendSmsDto) {
    return this.sms.send(tenantId, dto);
  }

  /** Bulk/campaign send. Opted-out numbers are skipped, not failed. */
  @Post('bulk')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  sendBulk(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: SendBulkSmsDto,
  ) {
    return this.sms.sendBulk(tenantId, dto);
  }

  /**
   * Inbound SMS webhook. Public; as with the email webhook, the MVP takes the
   * tenant as an explicit path param instead of a number-to-tenant mapping.
   */
  @Public()
  @Post('webhook/:tenantId')
  webhook(@Param('tenantId') tenantId: string, @Body() dto: InboundSmsDto) {
    return this.sms.receive(tenantId, dto);
  }

  /** Delivery-status callback. */
  @Public()
  @Post('status')
  status(@Body() dto: SmsStatusDto) {
    return this.sms.updateStatus(dto);
  }

  // ── Templates ────────────────────────────────
  @Get('templates')
  listTemplates(@CurrentUser('tenantId') tenantId: string) {
    return this.sms.listTemplates(tenantId);
  }

  @Post('templates')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  createTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateSmsTemplateDto,
  ) {
    return this.sms.createTemplate(tenantId, dto);
  }

  @Patch('templates/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  updateTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSmsTemplateDto,
  ) {
    return this.sms.updateTemplate(tenantId, id, dto);
  }

  @Delete('templates/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.sms.removeTemplate(tenantId, id);
  }

  // ── DND / opt-outs ───────────────────────────
  @Get('opt-outs')
  listOptOuts(@CurrentUser('tenantId') tenantId: string) {
    return this.sms.listOptOuts(tenantId);
  }

  @Post('opt-outs')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SUPPORT_AGENT)
  addOptOut(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateOptOutDto,
  ) {
    return this.sms.addOptOut(tenantId, dto.phone, dto.reason);
  }

  @Delete('opt-outs/:id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  removeOptOut(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.sms.removeOptOut(tenantId, id);
  }

  // ── OTP ──────────────────────────────────────
  @Post('otp/send')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT)
  sendOtp(@CurrentUser('tenantId') tenantId: string, @Body() dto: SendOtpDto) {
    return this.sms.sendOtp(tenantId, dto.phone);
  }

  @Post('otp/verify')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT)
  verifyOtp(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: VerifyOtpDto,
  ) {
    return this.sms.verifyOtp(tenantId, dto.phone, dto.code);
  }
}
