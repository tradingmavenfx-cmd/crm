import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RequestLinkDto {
  @IsEmail()
  email!: string;
}

export class StartSessionDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class PortalTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;
}

export class PortalCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;
}
