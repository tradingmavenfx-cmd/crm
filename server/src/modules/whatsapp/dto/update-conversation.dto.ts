import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateConversationDto {
  // Assign/transfer to an agent; null string clears assignment
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsIn(['open', 'pending', 'closed'])
  status?: string;
}
