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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role, WorkflowTrigger } from '@prisma/client';
import { WorkflowsService } from './workflows.service';
import {
  CreateWorkflowDto,
  InstallTemplateDto,
  QueryRunsDto,
  TestWorkflowDto,
  UpdateWorkflowDto,
} from './dto/workflow.dto';
import { WORKFLOW_EVENT } from './workflow-events';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly events: EventEmitter2,
  ) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.workflows.listWorkflows(tenantId);
  }

  /** Pre-built starting points. Declared before :id so it is not shadowed. */
  @Get('templates')
  templates() {
    return this.workflows.listTemplates();
  }

  @Get('analytics')
  analytics(@CurrentUser('tenantId') tenantId: string) {
    return this.workflows.analytics(tenantId);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.workflows.getWorkflow(tenantId, id);
  }

  @Post()
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateWorkflowDto,
  ) {
    return this.workflows.createWorkflow(tenantId, userId, dto);
  }

  @Post('templates/install')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  install(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: InstallTemplateDto,
  ) {
    return this.workflows.installTemplate(tenantId, userId, dto.templateId);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.workflows.updateWorkflow(tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN, Role.MANAGER)
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.workflows.removeWorkflow(tenantId, id);
  }

  /** Dry run: shows whether a record matches and what would happen. */
  @Post(':id/test')
  test(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: TestWorkflowDto,
  ) {
    return this.workflows.test(tenantId, id, dto.record);
  }

  @Get(':id/runs')
  runs(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Query() query: QueryRunsDto,
  ) {
    return this.workflows.listRuns(tenantId, id, query);
  }

  /**
   * Inbound webhook trigger. Public: anything posted here fires the workflows
   * whose trigger key matches, with the body as the record.
   */
  @Public()
  @Post('webhook/:tenantId/:key')
  async webhook(
    @Param('tenantId') tenantId: string,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.events.emit(WORKFLOW_EVENT, {
      tenantId,
      trigger: WorkflowTrigger.WEBHOOK,
      webhookKey: key,
      record: body ?? {},
    });
    return { received: true };
  }
}
