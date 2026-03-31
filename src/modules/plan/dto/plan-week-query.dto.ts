import { Matches } from 'class-validator';

export class PlanWeekQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  week_start!: string;
}
