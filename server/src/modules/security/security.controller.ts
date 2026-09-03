import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SecurityService } from './security.service';
import { AuditService } from './audit.service';
import { ComplianceService } from './compliance.service';
import {
  ErasureDto,
  QueryAuditDto,
  UpdateSecurityPolicyDto,
} from './dto/security.dto';

@ApiTags('security')
@Controller('security')
export class SecurityController {
  constructor(
    private readonly security: SecurityService,
    private readonly audit: AuditService,
    private readonly compliance: ComplianceService,
  ) {}

  // ── My own sessions ──────────────────────────

  @Get('sessions')
  sessions(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.security.listSessions(tenantId, userId);
  }

  @Delete('sessions/:id')
  revokeSession(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.security.revokeSession(tenantId, userId, id);
  }

  @Post('sessions/revoke-all')
  @HttpCode(200)
  revokeAll(@CurrentUser('userId') userId: string) {
    return this.security.revokeAll(userId, 'revoked_by_user');
  }

  // ── Policy and history ───────────────────────

  @Get('policy')
  @Roles(Role.TENANT_ADMIN)
  policy(@CurrentUser('tenantId') tenantId: string) {
    return this.security.policy(tenantId);
  }

  @Put('policy')
  @Roles(Role.TENANT_ADMIN)
  async updatePolicy(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateSecurityPolicyDto,
    @Ip() ip: string,
  ) {
    const before = await this.security.policy(tenantId);
    const saved = await this.security.updatePolicy(tenantId, dto);
    const after = await this.security.policy(tenantId);

    // Changing who can sign in, and for how long, is exactly the kind of
    // change an audit trail exists for.
    await this.audit.recordChange({
      tenantId,
      userId,
      entityType: 'security_policy',
      entityId: tenantId,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      ipAddress: ip,
    });

    return saved;
  }

  @Get('login-history')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  loginHistory(
    @CurrentUser('tenantId') tenantId: string,
    @Query('email') email?: string,
    @Query('limit') limit?: string,
  ) {
    return this.security.loginHistory(
      tenantId,
      email,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get('audit')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  auditTrail(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryAuditDto,
  ) {
    return this.audit.list(tenantId, query);
  }

  @Get('audit/:entityType/:entityId')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  history(
    @CurrentUser('tenantId') tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.audit.historyOf(tenantId, entityType, entityId);
  }

  // ── Compliance ───────────────────────────────

  @Get('export')
  @Roles(Role.TENANT_ADMIN)
  exportTenant(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.compliance.exportTenant(tenantId, userId);
  }

  @Get('export/person')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  exportPerson(
    @CurrentUser('tenantId') tenantId: string,
    @Query('email') email: string,
  ) {
    return this.compliance.exportPerson(tenantId, email);
  }

  @Post('erase')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(200)
  erase(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: ErasureDto,
  ) {
    return this.compliance.erasePerson(tenantId, userId, dto);
  }
}
