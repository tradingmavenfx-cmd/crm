import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Channel } from '@prisma/client';

export class RuleConditionsDto {
  /** Match if any keyword appears in the conversation's first inbound message */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}

export class CreateAssignmentRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Lower runs first; the first matching rule wins */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  /** Restrict to one channel, or omit to match every channel */
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuleConditionsDto)
  conditions?: RuleConditionsDto;

  @IsOptional()
  @IsIn(['specific', 'round_robin'])
  strategy?: string;

  /** Required for the "specific" strategy */
  @IsOptional()
  @IsString()
  assignToId?: string;
}

export class UpdateAssignmentRuleDto extends CreateAssignmentRuleDto {
  @IsOptional()
  @IsString()
  declare name: string;
}
