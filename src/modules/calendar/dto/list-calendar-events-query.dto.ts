import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListCalendarEventsQueryDto {
  @ApiProperty({ description: 'Start of date range in ISO 8601 format', example: '2026-04-09T00:00:00.000Z' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ description: 'End of date range in ISO 8601 format', example: '2026-04-16T00:00:00.000Z' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({ description: 'Filter by specific calendar connection ID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  connection_id?: string;
}
