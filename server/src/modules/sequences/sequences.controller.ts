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
import { SequencesService } from './sequences.service';
import {
  CreateSequenceDto,
  EnrollDto,
  UpdateSequenceDto,
} from './dto/sequence.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('sequences')
export class SequencesController {
  constructor(private readonly sequences: SequencesService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.sequences.listSequences(tenantId);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.sequences.getSequence(tenantId, id);
  }

  @Post()
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateSequenceDto,
  ) {
    return this.sequences.createSequence(tenantId, dto);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSequenceDto,
  ) {
    return this.sequences.updateSequence(tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.sequences.removeSequence(tenantId, id);
  }

  @Post(':id/enroll')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  enroll(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: EnrollDto,
  ) {
    return this.sequences.enroll(tenantId, id, dto.contactIds);
  }

  @Get(':id/enrollments')
  enrollments(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.sequences.listEnrollments(tenantId, id);
  }

  @Post('enrollments/:enrollmentId/stop')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER, Role.SALES_REP)
  stop(
    @CurrentUser('tenantId') tenantId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.sequences.stopEnrollment(tenantId, enrollmentId);
  }
}
