import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateRoutineDto {
  @ApiProperty({ description: '루틴 제목', example: '아침 10분 명상' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ description: '설명 및 메모', example: '호흡에 집중하기' })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiPropertyOptional({
    description: '반복할 요일 (0:일 ~ 6:토). timesPerWeek와 둘 중 하나만 지정',
    example: [1, 3, 5],
  })
  @IsArray()
  @IsOptional()
  daysOfWeek?: number[];

  @ApiPropertyOptional({
    description: '요일 없이 주 N회 반복 (1~6). daysOfWeek와 둘 중 하나만 지정',
    example: 3,
    minimum: 1,
    maximum: 6,
  })
  @IsInt()
  @Min(1)
  @Max(6)
  @IsOptional()
  timesPerWeek?: number;

  @ApiPropertyOptional({ description: '활성화 여부', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
