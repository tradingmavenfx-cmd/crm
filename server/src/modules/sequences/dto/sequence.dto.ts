import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SequenceStepDto {
  /** Hours to wait after the previous step (or after enrolment, for step 0) */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  delayHours!: number;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  /** Supports {{firstName}}, {{lastName}}, {{fullName}}, {{email}} */
  @IsString()
  @IsNotEmpty()
  body!: string;
}

export class CreateSequenceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  stopOnReply?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SequenceStepDto)
  steps!: SequenceStepDto[];
}

export class UpdateSequenceDto {
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
  @IsBoolean()
  stopOnReply?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SequenceStepDto)
  steps?: SequenceStepDto[];
}

export class EnrollDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  contactIds!: string[];
}
