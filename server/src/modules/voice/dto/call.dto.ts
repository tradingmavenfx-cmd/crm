import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CallDirection, CallStatus } from '@prisma/client';

export class ClickToCallDto {
  /** Customer number to reach (E.164) */
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** Link the call to a CRM contact; otherwise resolved from the number */
  @IsOptional()
  @IsString()
  contactId?: string;

  /** Overrides the calling agent's stored phone for this call */
  @IsOptional()
  @IsString()
  agentNumber?: string;
}

export class QueryCallsDto {
  @IsOptional()
  @IsEnum(CallDirection)
  direction?: CallDirection;

  @IsOptional()
  @IsEnum(CallStatus)
  status?: CallStatus;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
