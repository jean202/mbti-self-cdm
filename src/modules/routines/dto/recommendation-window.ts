import { ValidateBy } from 'class-validator';

export type RecommendationWindow =
  | { mode: 'CLOCK'; startMinutes: number; endMinutes: number }
  | { mode: 'AFTER_WAKE' | 'BEFORE_SLEEP'; durationMinutes: number }
  | { mode: 'ANYTIME' };

export function isRecommendationWindow(value: unknown): value is RecommendationWindow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const window = value as Record<string, unknown>;
  const integerInRange = (number: unknown, min: number, max: number) =>
    typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max;
  const onlyKeys = (keys: string[]) => Object.keys(window).every((key) => keys.includes(key));

  switch (window.mode) {
    case 'CLOCK':
      return onlyKeys(['mode', 'startMinutes', 'endMinutes'])
        && integerInRange(window.startMinutes, 0, 1439)
        && integerInRange(window.endMinutes, 0, 1439)
        && window.startMinutes !== window.endMinutes;
    case 'AFTER_WAKE':
    case 'BEFORE_SLEEP':
      return onlyKeys(['mode', 'durationMinutes'])
        && integerInRange(window.durationMinutes, 1, 1440);
    case 'ANYTIME':
      return onlyKeys(['mode']);
    default:
      return false;
  }
}

// Keep the object intact so ValidationPipe's whitelist cannot hide irrelevant fields.
export function IsRecommendationWindow(): PropertyDecorator {
  return ValidateBy({
    name: 'isRecommendationWindow',
    validator: {
      validate: (value: unknown) => value === null || isRecommendationWindow(value),
      defaultMessage: () => 'recommendationWindow must be null or a valid CLOCK, AFTER_WAKE, BEFORE_SLEEP, or ANYTIME window.',
    },
  });
}
