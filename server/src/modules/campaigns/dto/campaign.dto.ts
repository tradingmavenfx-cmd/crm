import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CampaignStatus, Channel } from '@prisma/client';

/** Audience filter. An empty segment means "every contact in the tenant". */
export class SegmentDto {
  /** Explicit contact ids - when set, the other filters are ignored */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contactIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minScore?: number;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(Channel)
  channel!: Channel;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  whatsappTemplateName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SegmentDto)
  segment?: SegmentDto;

  /** Leave unset to keep the campaign a draft you send manually */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  whatsappTemplateName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SegmentDto)
  segment?: SegmentDto;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsBoolean()
  clearSchedule?: boolean;
}

export class QueryCampaignsDto {
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;
}
