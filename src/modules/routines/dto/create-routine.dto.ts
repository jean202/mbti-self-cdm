import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRoutineDto {
  @ApiProperty({ description: '루틴 제목', example: '아침 10분 명상' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ description: '설명 및 메모', example: '호흡에 집중하기' })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ description: '반복할 요일 (0:일 ~ 6:토)', example: [1, 3, 5] })
  @IsArray()
  daysOfWeek!: number[];

  @ApiPropertyOptional({ description: '활성화 여부', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}