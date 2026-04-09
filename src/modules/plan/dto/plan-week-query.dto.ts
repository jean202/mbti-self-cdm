import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlanWeekQueryDto {
  @ApiProperty({ description: 'Start date of the week (YYYY-MM-DD, typically Monday)', example: '2026-04-06' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  week_start!: string;
}
