import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
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
