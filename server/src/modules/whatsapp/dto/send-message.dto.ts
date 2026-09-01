import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  to!: string; // E.164 phone number

  // For a free-text session message
  @ValidateIf((o) => !o.templateName)
  @IsString()
  @IsNotEmpty()
  text?: string;

  // For a template message (required outside the 24h session window)
  @IsOptional()
  @IsString()
  templateName?: string;

  @IsOptional()
  @IsString()
  languageCode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  parameters?: string[];
}

export class InteractiveOptionDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class SendInteractiveDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsIn(['buttons', 'list'])
  type!: 'buttons' | 'list';

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsString()
  header?: string;

  @IsOptional()
  @IsString()
  footer?: string;

  @IsOptional()
  @IsString()
  listButtonText?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => InteractiveOptionDto)
  options!: InteractiveOptionDto[];
}

export class SendMediaDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsIn(['image', 'video', 'document', 'audio'])
  kind!: 'image' | 'video' | 'document' | 'audio';

  @IsUrl()
  url!: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  filename?: string;
}
