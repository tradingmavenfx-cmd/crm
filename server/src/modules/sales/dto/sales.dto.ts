import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ContestMetric, ForecastCategory, QuotaPeriod } from '@prisma/client';

/** What a territory claims. Every clause that is set has to match. */
export interface TerritoryRules {
  countries?: string[];
  states?: string[];
  cities?: string[];
  industries?: string[];
  /** Email/website domains, matched exactly or as a suffix */
  domains?: string[];
  minEmployees?: number;
  maxEmployees?: number;
}

export class CreateTerritoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsObject()
  rules?: TerritoryRules;
}

export class UpdateTerritoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  rules?: TerritoryRules;
}

export class TerritoryMemberDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

export class UpsertQuotaDto {
  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  territoryId?: string;

  @IsEnum(QuotaPeriod)
  period!: QuotaPeriod;

  /** Any date inside the period; it is snapped to the period's first day */
  @IsDateString()
  periodStart!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class ForecastQueryDto {
  @IsOptional()
  @IsEnum(QuotaPeriod)
  period?: QuotaPeriod;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  territoryId?: string;
}

export class WhatIfDto extends ForecastQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  commitOdds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  bestCaseOdds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  pipelineOdds?: number;
}

export class CategoriseDealDto {
  @IsEnum(ForecastCategory)
  category!: ForecastCategory;
}

export class LeaderboardDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(ContestMetric)
  metric?: ContestMetric;
}

export class CreateContestDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(ContestMetric)
  metric!: ContestMetric;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsString()
  prize?: string;
}

export class CreateBadgeDto {
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, {
    message: 'key must be lowercase words separated by - or _',
  })
  key!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsEnum(ContestMetric)
  metric!: ContestMetric;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  threshold!: number;
}

export class AssignTerritoriesDto {
  /** Also move accounts that already belong somewhere */
  @IsOptional()
  @IsBoolean()
  reassignAll?: boolean;
}

export class PerformanceQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
