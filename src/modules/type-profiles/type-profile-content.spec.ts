import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// data/type-profiles 콘텐츠 팩이 docs/type-profile-data-model.md 규칙을 지키는지 검증한다.
// 콘텐츠를 손으로 고치다 생기는 실수(필드 누락, 키 불일치, 유형 간 중복)를 배포 전에 잡는다.

type CognitiveFunction = `${'S' | 'N' | 'T' | 'F'}${'e' | 'i'}`;

interface TypeProfile {
  schema_version: string;
  profile_version: string;
  type_code: string;
  cognitive_stack: Record<
    'dominant' | 'auxiliary' | 'tertiary' | 'inferior',
    CognitiveFunction
  >;
  differentiation: {
    core_driver: string;
    close_type_contrasts: Array<{ type_code: string; difference_summary: string }>;
  };
  home_mode: { mode_key: string; card_priority: string[] };
  task_capture_style: { style_key: string };
  planning_style: { style_key: string };
  reminder_tone: {
    tone_key: string;
    intensity_floor: string;
    intensity_ceiling: string;
  };
  review_prompts: Array<{ key: string; intent: string }>;
  stress_signals: Array<{ key: string; ui_escalation: string }>;
  recovery_protocol: {
    protocol_key: string;
    default_duration_minutes: number;
    steps: string[];
  };
  forbidden_patterns: string[];
  micro_adjustment_bounds: {
    reminder_intensity: { min: string; max: string };
    home_card_order: { fixed: string[]; mutable: string[] };
  };
  copy: Record<
    string,
    {
      type_title: string;
      type_summary: string;
      review_prompt_labels: Record<string, string>;
    }
  >;
}

const DATA_ROOT = join(process.cwd(), 'data/type-profiles');
const REQUIRED_ROOT_FIELDS = [
  'schema_version',
  'profile_version',
  'type_code',
  'cognitive_stack',
  'differentiation',
  'home_mode',
  'task_capture_style',
  'planning_style',
  'reminder_tone',
  'review_prompts',
  'stress_signals',
  'recovery_protocol',
  'forbidden_patterns',
  'micro_adjustment_bounds',
  'copy',
];
const HOME_CARD_KEYS = [
  'today_focus',
  'priority_tasks',
  'calendar_summary',
  'personalized_prompt',
  'recovery_card',
];
const INTENSITY_ORDER = ['low', 'medium', 'high'];
const OPPOSITE_LETTER: Record<string, string> = { S: 'N', N: 'S', T: 'F', F: 'T' };
const OPPOSITE_ATTITUDE: Record<string, string> = { e: 'i', i: 'e' };

// 표준 type dynamics(Beebe 모델 1~4번 기능)를 유형 코드에서 유도한다.
function expectedCognitiveStack(typeCode: string) {
  const [attitude, perceiving, judging, lifestyle] = typeCode.split('');
  const extravertedFunction =
    lifestyle === 'J' ? `${judging}e` : `${perceiving}e`;
  const introvertedFunction =
    lifestyle === 'J' ? `${perceiving}i` : `${judging}i`;
  const dominant = attitude === 'E' ? extravertedFunction : introvertedFunction;
  const auxiliary = attitude === 'E' ? introvertedFunction : extravertedFunction;
  const tertiary = `${OPPOSITE_LETTER[auxiliary[0]]}${dominant[1]}`;
  const inferior = `${OPPOSITE_LETTER[dominant[0]]}${OPPOSITE_ATTITUDE[dominant[1]]}`;

  return { dominant, auxiliary, tertiary, inferior };
}

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(join(DATA_ROOT, ...segments), 'utf8')) as T;
}

const versions = readdirSync(DATA_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('expectedCognitiveStack', () => {
  it.each([
    ['INFP', ['Fi', 'Ne', 'Si', 'Te']],
    ['INFJ', ['Ni', 'Fe', 'Ti', 'Se']],
    ['ESTJ', ['Te', 'Si', 'Ne', 'Fi']],
    ['ENTP', ['Ne', 'Ti', 'Fe', 'Si']],
    ['ISTP', ['Ti', 'Se', 'Ni', 'Fe']],
  ])('derives the %s stack', (typeCode, stack) => {
    expect(Object.values(expectedCognitiveStack(typeCode))).toEqual(stack);
  });
});

describe.each(versions)('type profile pack %s', (version) => {
  const manifest = readJson<{
    profile_version: string;
    default_locale: string;
    supported_locales: string[];
    available_types: string[];
  }>(version, 'manifest.json');
  const profiles = new Map(
    manifest.available_types.map((typeCode) => [
      typeCode,
      readJson<TypeProfile>(version, `${typeCode}.json`),
    ]),
  );

  it('declares all 16 types exactly once', () => {
    expect([...manifest.available_types].sort()).toEqual(
      [
        'ENFJ', 'ENFP', 'ENTJ', 'ENTP', 'ESFJ', 'ESFP', 'ESTJ', 'ESTP',
        'INFJ', 'INFP', 'INTJ', 'INTP', 'ISFJ', 'ISFP', 'ISTJ', 'ISTP',
      ],
    );
    expect(manifest.profile_version).toBe(version);
    expect(manifest.supported_locales).toContain(manifest.default_locale);
  });

  describe.each(manifest.available_types)('%s', (typeCode) => {
    const profile = profiles.get(typeCode)!;

    it('has every required root field and matches its file name and pack', () => {
      for (const field of REQUIRED_ROOT_FIELDS) {
        expect(profile).toHaveProperty(field);
      }
      expect(profile.type_code).toBe(typeCode);
      expect(profile.profile_version).toBe(version);
    });

    it('uses the cognitive stack implied by the type code', () => {
      expect(profile.cognitive_stack).toEqual(expectedCognitiveStack(typeCode));
    });

    it('orders exactly the five home cards and splits them into fixed and mutable', () => {
      const { card_priority } = profile.home_mode;
      const { fixed, mutable } = profile.micro_adjustment_bounds.home_card_order;

      expect([...card_priority].sort()).toEqual([...HOME_CARD_KEYS].sort());
      expect([...fixed, ...mutable].sort()).toEqual([...card_priority].sort());
      expect(fixed.filter((key) => mutable.includes(key))).toEqual([]);
      // 고정 카드는 기본 순서의 맨 앞에 있어야 행동 데이터가 순서를 바꿔도 의미가 유지된다.
      expect(card_priority.slice(0, fixed.length)).toEqual(fixed);
    });

    it('keeps reminder intensity bounds inside the reminder tone range', () => {
      const floor = INTENSITY_ORDER.indexOf(profile.reminder_tone.intensity_floor);
      const ceiling = INTENSITY_ORDER.indexOf(profile.reminder_tone.intensity_ceiling);
      const min = INTENSITY_ORDER.indexOf(profile.micro_adjustment_bounds.reminder_intensity.min);
      const max = INTENSITY_ORDER.indexOf(profile.micro_adjustment_bounds.reminder_intensity.max);

      for (const value of [floor, ceiling, min, max]) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(floor).toBeLessThanOrEqual(ceiling);
      expect(min).toBeGreaterThanOrEqual(floor);
      expect(max).toBeLessThanOrEqual(ceiling);
    });

    it('labels every review prompt in every supported locale', () => {
      const promptKeys = profile.review_prompts.map((prompt) => prompt.key);

      expect(promptKeys.length).toBeGreaterThan(0);
      expect(new Set(promptKeys).size).toBe(promptKeys.length);
      for (const locale of manifest.supported_locales) {
        const copy = profile.copy[locale];

        expect(copy).toBeDefined();
        expect(copy.type_title.trim()).not.toBe('');
        expect(copy.type_summary.trim()).not.toBe('');
        expect(Object.keys(copy.review_prompt_labels).sort()).toEqual(
          [...promptKeys].sort(),
        );
        for (const label of Object.values(copy.review_prompt_labels)) {
          expect(label.trim()).not.toBe('');
        }
      }
    });

    it('defines a usable recovery protocol, stress signals and forbidden patterns', () => {
      expect(profile.recovery_protocol.default_duration_minutes).toBeGreaterThan(0);
      expect(profile.recovery_protocol.steps.length).toBeGreaterThan(0);
      expect(profile.stress_signals.length).toBeGreaterThan(0);
      for (const signal of profile.stress_signals) {
        expect(signal.key).toBeTruthy();
        expect(signal.ui_escalation).toBeTruthy();
      }
      expect(profile.forbidden_patterns.length).toBeGreaterThan(0);
    });

    it('contrasts itself only with other real types', () => {
      const contrasts = profile.differentiation.close_type_contrasts;

      expect(contrasts.length).toBeGreaterThan(0);
      for (const contrast of contrasts) {
        expect(manifest.available_types).toContain(contrast.type_code);
        expect(contrast.type_code).not.toBe(typeCode);
        expect(contrast.difference_summary.trim()).not.toBe('');
      }
    });
  });

  it('gives every type a distinct experience (no two types share a key set)', () => {
    const signatures = [...profiles.values()].map((profile) =>
      [
        profile.home_mode.mode_key,
        profile.task_capture_style.style_key,
        profile.planning_style.style_key,
        profile.reminder_tone.tone_key,
        profile.recovery_protocol.protocol_key,
      ].join('|'),
    );

    expect(new Set(signatures).size).toBe(profiles.size);
  });

  it('differentiates close-looking pairs such as INFP and INFJ on home mode', () => {
    for (const [left, right] of [
      ['INFP', 'INFJ'],
      ['INTP', 'INTJ'],
      ['ISFP', 'ISFJ'],
      ['ENFP', 'ENFJ'],
    ]) {
      expect(profiles.get(left)!.home_mode.mode_key).not.toBe(
        profiles.get(right)!.home_mode.mode_key,
      );
    }
  });
});
