import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { LeadStatus } from '@prisma/client';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  sourceDetail?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  disqualifiedReason?: string;
}

/** Everything a capture can carry, including where it came from. */
export class CaptureLeadDto extends CreateLeadDto {
  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  utmTerm?: string;

  @IsOptional()
  @IsString()
  utmContent?: string;
}

export class QueryLeadsDto {
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @IsOptional()
  @IsString()
  search?: string;
}

export class ConvertLeadDto {
  /** An existing account to attach the new contact to */
  @IsOptional()
  @IsString()
  companyId?: string;

  /** Create an account from the company the lead typed (default: yes) */
  @IsOptional()
  @IsBoolean()
  createCompany?: boolean;

  @IsOptional()
  @IsString()
  dealTitle?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dealValue?: number;

  @IsOptional()
  @IsDateString()
  expectedAt?: string;
}

// ── Forms and pages ────────────────────────────

export class FormFieldDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsIn(['text', 'email', 'tel', 'textarea', 'select'])
  type!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

export class CreateFormDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsArray()
  fields?: FormFieldDto[];

  @IsOptional()
  @IsString()
  assignToId?: string;

  @IsOptional()
  @IsString()
  sequenceId?: string;

  @IsOptional()
  @IsString()
  thankYou?: string;
}

export class UpdateFormDto extends CreateFormDto {
  @IsOptional()
  @IsString()
  declare name: string;
}

export class PageBlockDto {
  @IsIn(['heading', 'text', 'image', 'form', 'button'])
  type!: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  src?: string;

  @IsOptional()
  @IsString()
  alt?: string;

  @IsOptional()
  @IsString()
  href?: string;
}

export class CreatePageDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase words separated by hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsArray()
  blocks?: PageBlockDto[];

  @IsOptional()
  @IsString()
  formId?: string;

  @IsOptional()
  @IsString()
  metaTitle?: string;

  @IsOptional()
  @IsString()
  metaDescription?: string;

  /** Makes this page a variant of another, for an A/B test */
  @IsOptional()
  @IsString()
  variantOfId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  variantWeight?: number;
}

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsArray()
  blocks?: PageBlockDto[];

  @IsOptional()
  @IsString()
  formId?: string;

  @IsOptional()
  @IsString()
  metaTitle?: string;

  @IsOptional()
  @IsString()
  metaDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  variantWeight?: number;
}

export class SubmitFormDto {
  @IsOptional()
  @IsString()
  pageId?: string;

  @IsObject()
  data!: Record<string, string>;

  @IsOptional()
  @IsObject()
  utm?: Record<string, string>;
}

export class AttributionQueryDto {
  @IsOptional()
  @IsIn(['first', 'last', 'linear'])
  model?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
