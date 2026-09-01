import { IsNotEmpty, IsString, Length } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @Length(4, 8)
  code!: string;
}
