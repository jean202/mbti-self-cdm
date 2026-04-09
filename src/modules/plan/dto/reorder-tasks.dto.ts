import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderTaskItemDto {
  @ApiProperty({ description: 'Task ID to reorder', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  task_id!: string;

  @ApiProperty({ description: 'New sort order position', example: 1 })
  @IsInt()
  sort_order!: number;
}

export class ReorderTasksDto {
  @ApiProperty({ description: 'Local date for the reorder operation (YYYY-MM-DD)', example: '2026-04-09' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  local_date!: string;

  @ApiProperty({ description: 'List of tasks with their new sort orders', type: () => [ReorderTaskItemDto], isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderTaskItemDto)
  items!: ReorderTaskItemDto[];
}
