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

class MbtiFinderAnswerInputDto {
  @IsString()
  @MaxLength(64)
  question_id!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  answer_value!: number;
}

export class SubmitMbtiFinderAnswersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MbtiFinderAnswerInputDto)
  answers!: MbtiFinderAnswerInputDto[];
}
