import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class SendSmsDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  // Text is required only when not sending from a template.
  @ValidateIf((o) => !o.templateId)
  @IsString()
  @IsNotEmpty()
  text?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  // Values for {{merge}} fields in the template body
  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}

export class SendBulkSmsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  to!: string[];

  @ValidateIf((o) => !o.templateId)
  @IsString()
  @IsNotEmpty()
  text?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}
