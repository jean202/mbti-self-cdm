import { VideoSuggestionAction, VideoSuggestionState } from '@prisma/client';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordVideoSuggestionFeedbackDto {
  @ApiProperty({ description: 'State the suggestion was shown for', enum: VideoSuggestionState, example: 'LOW_MOOD' })
  @IsEnum(VideoSuggestionState)
  state!: VideoSuggestionState;

  @ApiProperty({ description: 'What the user did with the suggestion', enum: VideoSuggestionAction, example: 'DISMISSED' })
  @IsEnum(VideoSuggestionAction)
  action!: VideoSuggestionAction;

  @ApiPropertyOptional({ description: 'YouTube video id the user opened', example: 'abcdEFGH123' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{11}$/)
  video_id?: string;
}
