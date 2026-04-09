import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class MbtiFinderAnswerInputDto {
  @ApiProperty({ description: 'Question identifier', example: 'q_ei_01', maxLength: 64 })
  @IsString()
  @MaxLength(64)
  question_id!: string;

  @ApiProperty({ description: 'Answer value on a 1-5 Likert scale', example: 4, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  answer_value!: number;
}

export class SubmitMbtiFinderAnswersDto {
  @ApiProperty({ description: 'List of answers to MBTI finder questions', type: () => [MbtiFinderAnswerInputDto], isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MbtiFinderAnswerInputDto)
  answers!: MbtiFinderAnswerInputDto[];
}
