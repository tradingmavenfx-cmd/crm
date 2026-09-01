import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateOptOutDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsIn(['stop_keyword', 'manual', 'dnd_registry'])
  reason?: string;
}
