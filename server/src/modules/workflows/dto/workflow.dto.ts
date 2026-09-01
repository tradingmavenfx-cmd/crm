import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { WorkflowRunStatus, WorkflowTrigger } from '@prisma/client';

export const WORKFLOW_ACTIONS = [
  'send_email',
  'send_sms',
  'send_whatsapp',
  'create_task',
  'create_activity',
  'assign_owner',
  'update_field',
  'add_to_sequence',
  'webhook',
] as const;

export type WorkflowActionType = (typeof WORKFLOW_ACTIONS)[number];

export class WorkflowActionDto {
  @IsIn(WORKFLOW_ACTIONS as unknown as string[])
  type!: WorkflowActionType;

  /**
   * Action detail, by type:
   *   send_email      { to?, subject, body }        to defaults to the record's email
   *   send_sms        { to?, text }                 to defaults to the record's phone
   *   send_whatsapp   { to?, templateName }
   *   create_task     { title, priority?, dueInHours?, assigneeId? }
   *   create_activity { type?, subject, body? }
   *   assign_owner    { userId } or { strategy: 'round_robin' }
   *   update_field    { field, value }
   *   add_to_sequence { sequenceId }
   *   webhook         { url, method?, headers? }
   * String values support {{field}} merge from the triggering record.
   */
  @IsObject()
  config!: Record<string, unknown>;
}

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsEnum(WorkflowTrigger)
  trigger!: WorkflowTrigger;

  @IsOptional()
  @IsIn(['contact', 'company', 'deal', 'task'])
  triggerEntity?: string;

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => WorkflowActionDto)
  actions!: WorkflowActionDto[];
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(WorkflowTrigger)
  trigger?: WorkflowTrigger;

  @IsOptional()
  @IsIn(['contact', 'company', 'deal', 'task'])
  triggerEntity?: string;

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowActionDto)
  actions?: WorkflowActionDto[];
}

export class QueryRunsDto {
  @IsOptional()
  @IsEnum(WorkflowRunStatus)
  status?: WorkflowRunStatus;
}

/** Dry-run a workflow against a record without touching anything. */
export class TestWorkflowDto {
  @IsObject()
  record!: Record<string, unknown>;
}

export class InstallTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateId!: string;
}
