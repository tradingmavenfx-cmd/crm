import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSmsTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;
}

export class UpdateSmsTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
