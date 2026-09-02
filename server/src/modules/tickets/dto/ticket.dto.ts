import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Channel, TicketPriority, TicketStatus } from '@prisma/client';

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @IsOptional()
  @IsString()
  requesterId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  slaPolicyId?: string;

  /** Makes this ticket a child of another */
  @IsOptional()
  @IsString()
  parentId?: string;
}

export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** Empty string unassigns */
  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class QueryTicketsDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  /** "true" narrows to tickets that have missed an SLA target */
  @IsOptional()
  @IsIn(['true', 'false'])
  breached?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class TicketCommentDto {
  @IsString()
  @IsNotEmpty()
  body!: string;

  /** Internal notes are never shown to the requester */
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;

  /** Also send the reply out on this channel */
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;
}

export class MergeTicketDto {
  @IsString()
  @IsNotEmpty()
  intoTicketId!: string;
}

export class ResolveTicketDto {
  @IsOptional()
  @IsString()
  resolution?: string;
}

/** Posted from the customer-facing survey link. */
export class CsatDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

// ── SLA policies ─────────────────────────────

export class SlaTargetsDto {
  @IsObject()
  firstResponseMinutes!: Record<string, number>;

  @IsObject()
  resolutionMinutes!: Record<string, number>;
}

export class CreateSlaPolicyDto extends SlaTargetsDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

// ── Routing rules ────────────────────────────

export class CreateTicketRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  /** { keywords: ["refund"], channel: "EMAIL" } */
  @IsOptional()
  @IsObject()
  conditions?: { keywords?: string[]; channel?: Channel };

  @IsOptional()
  @IsString()
  setCategory?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  setPriority?: TicketPriority;

  @IsOptional()
  @IsIn(['specific', 'round_robin', 'load_based'])
  strategy?: string;

  @IsOptional()
  @IsString()
  assignToId?: string;
}

export class LinkTicketsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  childIds!: string[];
}
