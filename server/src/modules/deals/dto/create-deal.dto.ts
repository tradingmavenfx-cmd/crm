import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateDealDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsNumberString()
  value?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  stageId!: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsIn(['open', 'won', 'lost'])
  status?: string;
}
