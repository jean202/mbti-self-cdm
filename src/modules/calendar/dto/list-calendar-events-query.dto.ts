import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class ListCalendarEventsQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @IsOptional()
  @IsUUID()
  connection_id?: string;
}
