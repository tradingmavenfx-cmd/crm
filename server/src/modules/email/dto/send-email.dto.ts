import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class SendEmailDto {
  @IsEmail()
  to!: string;

  // Subject is required only when not sending from a template
  // (a template supplies its own subject).
  @ValidateIf((o) => !o.templateId)
  @IsString()
  @IsNotEmpty()
  subject?: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsString()
  text?: string;

  // Optionally send from a saved template (subject/body used if provided)
  @IsOptional()
  @IsString()
  templateId?: string;
}
