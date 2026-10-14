import { ApiProperty } from '@nestjs/swagger';

import { IsRecommendationWindow, type RecommendationWindow } from './recommendation-window';

export class UpdateRecommendationWindowDto {
  @ApiProperty({
    description: '필수 추천 시간 설정. CLOCK: startMinutes/endMinutes(0~1439, 서로 다름), AFTER_WAKE/BEFORE_SLEEP: durationMinutes(1~1440), ANYTIME: 기상 시간 내 언제든지. null이면 설정 제거',
    type: Object,
    nullable: true,
    example: { mode: 'CLOCK', startMinutes: 1320, endMinutes: 120 },
  })
  // Do not use IsOptional/IsDefined: null clears, but undefined must fail validation.
  @IsRecommendationWindow()
  recommendationWindow!: RecommendationWindow | null;
}
