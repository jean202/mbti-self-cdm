import { IdeaStatus } from '@prisma/client';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsReviewDate } from '../idea-review-date';

export class UpdateIdeaDto {
  @ApiPropertyOptional({ description: 'Updated idea title', example: 'Build a habit tracker app v2', minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Updated notes for the idea', example: 'Add gamification features', nullable: true, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @ApiPropertyOptional({ description: 'Updated idea status', enum: [IdeaStatus.ACTIVE, IdeaStatus.ARCHIVED], example: 'ACTIVE' })
  @IsOptional()
  @IsIn([IdeaStatus.ACTIVE, IdeaStatus.ARCHIVED])
  status?: IdeaStatus;

  @ApiPropertyOptional({ description: 'Local date to revisit; null clears it', example: '2026-10-18', nullable: true })
  @IsOptional()
  @IsReviewDate()
  review_on?: string | null;

  @ApiPropertyOptional({ description: 'Updated tags for the idea', example: ['productivity', 'gamification'], type: String, isArray: true, nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags?: string[] | null;
}
