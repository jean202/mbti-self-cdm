import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export class ReorderTaskItemDto {
  @IsUUID()
  task_id!: string;

  @IsInt()
  sort_order!: number;
}

export class ReorderTasksDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderTaskItemDto)
  items!: ReorderTaskItemDto[];
}
