import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Channel } from '@prisma/client';

export class QueryInboxDto {
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @IsOptional()
  @IsIn(['open', 'pending', 'closed'])
  status?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
