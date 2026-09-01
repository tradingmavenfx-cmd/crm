import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Role } from '@prisma/client';

export const CHART_TYPES = ['bar', 'line', 'donut', 'funnel', 'table', 'stat'];

export class RunReportDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}

export class CreateDashboardDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** Empty means everyone in the tenant can see it */
  @IsOptional()
  @IsArray()
  @IsIn(Object.values(Role), { each: true })
  visibleToRoles?: Role[];
}

export class UpdateDashboardDto extends CreateDashboardDto {
  @IsOptional()
  @IsString()
  declare name: string;
}

export class CreateWidgetDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  reportKey!: string;

  @IsOptional()
  @IsIn(CHART_TYPES)
  chart?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['half', 'full'])
  width?: string;
}

export class UpdateWidgetDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsIn(CHART_TYPES)
  chart?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['half', 'full'])
  width?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

/** Explicit widget order, sent after a drag or a move. */
export class ReorderWidgetsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  widgetIds!: string[];
}

export class CreateScheduleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  reportKey!: string;

  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  frequency?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'sendAt must be HH:MM' })
  sendAt?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  recipients!: string[];

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  frequency?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'sendAt must be HH:MM' })
  sendAt?: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  recipients?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
