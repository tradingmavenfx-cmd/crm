import { IsInt, IsString, Max, Min } from 'class-validator';

export class CreateStageDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  probability!: number;
}
