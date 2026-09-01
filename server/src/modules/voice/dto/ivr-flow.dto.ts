import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export const IVR_ACTIONS = [
  'menu',
  'transfer',
  'voicemail',
  'message',
  'crm_lookup',
  'hangup',
] as const;

export type IvrActionType = (typeof IVR_ACTIONS)[number];

export class IvrOptionDto {
  /** Single DTMF key that selects this option */
  @Matches(/^[0-9*#]$/, { message: 'digit must be a single key 0-9, * or #' })
  digit!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsIn(IVR_ACTIONS as unknown as string[])
  action!: IvrActionType;

  /**
   * menu       -> id of the IvrFlow to descend into
   * transfer   -> a user id (agent) or a raw phone number
   * message    -> the text to read out
   * crm_lookup -> which record to read back: "deal" (default) or "task"
   * voicemail / hangup -> unused
   */
  @IsOptional()
  @IsString()
  value?: string;
}

export class CreateIvrFlowDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  greeting!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IvrOptionDto)
  options!: IvrOptionDto[];
}

export class UpdateIvrFlowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  greeting?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IvrOptionDto)
  options?: IvrOptionDto[];
}
