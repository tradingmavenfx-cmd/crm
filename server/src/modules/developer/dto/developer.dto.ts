import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** "contacts:read", "deals:write", "contacts:*" or "*". Defaults to "*". */
  @IsOptional()
  @IsArray()
  @Matches(/^(\*|[a-z-]+:(read|write|\*))$/, { each: true })
  scopes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6000)
  rateLimitPerMinute?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class CreateWebhookDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  // require_tld is off so a destination inside a private network, or a tunnel
  // used while developing, is not rejected out of hand.
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  url!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events!: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TestWebhookDto {
  @IsOptional()
  @IsString()
  event?: string;
}
