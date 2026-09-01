import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReplyDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  // Optional subject override for email replies
  @IsOptional()
  @IsString()
  subject?: string;
}
