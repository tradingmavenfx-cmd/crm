import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsIn(['open', 'pending', 'closed'])
  status?: string;
}

export class CreateNoteDto {
  @IsString()
  body!: string;
}
