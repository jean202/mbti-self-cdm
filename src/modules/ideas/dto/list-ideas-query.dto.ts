import { IdeaStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsReviewDate } from '../idea-review-date';

export class ListIdeasQueryDto {
  @ApiPropertyOptional({ description: 'Filter by idea status', enum: IdeaStatus, example: 'ACTIVE' })
  @IsOptional()
  @IsEnum(IdeaStatus)
  status?: IdeaStatus;

  @ApiPropertyOptional({ description: 'Opaque timestamp/ID cursor; owned legacy UUID cursors remain supported', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive substring search in title and note', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  q?: string;

  @ApiPropertyOptional({ description: 'Inclusive review date, ACTIVE ideas only', example: '2026-10-18' })
  @IsOptional()
  @IsReviewDate()
  review_before?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
