import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** Opens or resumes a widget session. */
export class StartChatDto {
  /** Returned by a previous start call; omit for a brand-new visitor */
  @IsOptional()
  @IsString()
  visitorKey?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  currentPage?: string;
}

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  visitorKey!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;
}

export class ChatPollDto {
  @IsString()
  @IsNotEmpty()
  visitorKey!: string;
}

/** Fired as the visitor moves around the site. */
export class ChatPageViewDto {
  @IsString()
  @IsNotEmpty()
  visitorKey!: string;

  @IsString()
  @IsNotEmpty()
  currentPage!: string;
}

export class ChatRatingDto {
  @IsString()
  @IsNotEmpty()
  visitorKey!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
