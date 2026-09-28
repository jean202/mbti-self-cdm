import { readFileSync } from 'fs';
import { join } from 'path';

import {
  type VideoSuggestionCopySet,
  VideoSuggestionsService,
} from './video-suggestions.service';

const NOW = new Date('2026-09-28T09:00:00Z');
const PACK_DIR = join(__dirname, '../../../data/type-profiles/2026-03-v1');

const COPY_SET: VideoSuggestionCopySet = {
  low_mood: {
    title: '자책은 잠시 내려놓아요',
    body: '위로가 되는 영상 하나 함께 볼까요?',
    search_query: '자기 연민 명상 10분',
    videos: [],
  },
  unresponsive: {
    title: '다시 의미를 떠올려봐요',
    body: '나에게 중요한 것을 다시 떠올려요.',
    search_query: '나다운 삶 가치 찾기',
    videos: [],
  },
  overaroused: {
    title: '벅찬 마음을 차분하게',
    body: '잠시 숨을 고르세요.',
    search_query: '감정 정리 명상 5분',
    videos: [],
  },
};

function check(moodScore: number, energyScore: number, hoursAgo: number) {
  return {
    moodScore,
    energyScore,
    createdAt: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000),
  };
}

function createMocks(options: {
  checks?: unknown[];
  suppressed?: boolean;
  apiKey?: string;
  cached?: string | null;
}) {
  const prisma = {
    moodEnergyCheck: {
      findMany: jest.fn().mockResolvedValue(options.checks ?? []),
    },
    videoSuggestionFeedback: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.suppressed ? { id: 'feedback-1' } : null),
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'feedback-new',
        createdAt: NOW,
        ...data,
      })),
    },
    mbtiProfile: {
      findUnique: jest.fn().mockResolvedValue({ typeCode: 'INFP' }),
    },
  } as any;
  const redisClient = {
    get: jest.fn().mockResolvedValue(options.cached ?? null),
    set: jest.fn().mockResolvedValue('OK'),
  };
  const redis = { getClient: () => redisClient } as any;
  const config = {
    get: jest.fn((key: string) =>
      key === 'YOUTUBE_API_KEY' ? options.apiKey : undefined,
    ),
  } as any;

  return {
    prisma,
    redisClient,
    service: new VideoSuggestionsService(prisma, redis, config),
  };
}

function build(
  service: VideoSuggestionsService,
  overrides: Partial<Parameters<VideoSuggestionsService['buildSuggestion']>[0]> = {},
) {
  return service.buildSuggestion({
    userId: 'user-1',
    typeCode: 'INFP',
    locale: 'ko-KR',
    copySet: COPY_SET,
    inactiveDays: 0,
    now: NOW,
    ...overrides,
  });
}

describe('VideoSuggestionsService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should suggest low mood videos with a search link when no api key is set', async () => {
    const { service } = createMocks({ checks: [check(2, 3, 2)] });

    const result = await build(service);

    expect(result).toMatchObject({
      state: 'LOW_MOOD',
      type_code: 'INFP',
      title: '자책은 잠시 내려놓아요',
      videos: [],
      source: 'SEARCH_LINK',
      support_notice: null,
    });
    expect(result!.search_url).toBe(
      `https://www.youtube.com/results?search_query=${encodeURIComponent('자기 연민 명상 10분')}`,
    );
  });

  it('should add a support notice when mood stays low across recent checks', async () => {
    const { service } = createMocks({
      checks: [check(1, 2, 2), check(2, 2, 26), check(1, 1, 50)],
    });

    const result = await build(service);

    expect(result!.state).toBe('LOW_MOOD');
    expect(result!.support_notice).toMatchObject({
      contacts: expect.arrayContaining([
        expect.objectContaining({ phone: '109' }),
      ]),
    });
  });

  it('should detect an overaroused state from high energy and mood', async () => {
    const { service } = createMocks({ checks: [check(5, 5, 1)] });

    const result = await build(service);

    expect(result).toMatchObject({
      state: 'OVERAROUSED',
      title: '벅찬 마음을 차분하게',
    });
  });

  it('should detect an unresponsive state after three inactive days', async () => {
    const { service } = createMocks({ checks: [] });

    const result = await build(service, { inactiveDays: 3 });

    expect(result).toMatchObject({
      state: 'UNRESPONSIVE',
      title: '다시 의미를 떠올려봐요',
    });
  });

  it('should ignore mood checks older than three days', async () => {
    const { service } = createMocks({ checks: [check(1, 1, 4 * 24)] });

    expect(await build(service)).toBeNull();
  });

  it('should return null when nothing calls for a video', async () => {
    const { service } = createMocks({ checks: [check(4, 3, 2)] });

    expect(await build(service)).toBeNull();
  });

  it('should stay hidden after the user dismissed or opened it recently', async () => {
    const { service, prisma } = createMocks({
      checks: [check(2, 3, 2)],
      suppressed: true,
    });

    expect(await build(service)).toBeNull();
    expect(prisma.videoSuggestionFeedback.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', state: 'LOW_MOOD' }),
      }),
    );
  });

  it('should prefer curated videos from the type profile', async () => {
    const { service } = createMocks({
      checks: [check(2, 3, 2)],
      apiKey: 'key',
    });
    global.fetch = jest.fn();

    const result = await build(service, {
      copySet: {
        ...COPY_SET,
        low_mood: {
          ...COPY_SET.low_mood,
          videos: [
            { video_id: 'abcdEFGH123', title: '명상', channel_title: '채널' },
            { video_id: 'not-a-valid-id' },
          ],
        },
      },
    });

    expect(result!.source).toBe('CURATED');
    expect(result!.videos).toEqual([
      {
        video_id: 'abcdEFGH123',
        title: '명상',
        channel_title: '채널',
        thumbnail_url: 'https://i.ytimg.com/vi/abcdEFGH123/mqdefault.jpg',
        url: 'https://www.youtube.com/watch?v=abcdEFGH123',
      },
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should search YouTube with safe search and cache the result', async () => {
    const { service, redisClient } = createMocks({
      checks: [check(2, 3, 2)],
      apiKey: 'key',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: { videoId: 'abcdEFGH123' },
            snippet: { title: 'Tom &amp; Jerry&#39;s 명상', channelTitle: '채널' },
          },
        ],
      }),
    });

    const result = await build(service);
    const requestUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0]);

    expect(requestUrl.searchParams.get('q')).toBe('자기 연민 명상 10분');
    expect(requestUrl.searchParams.get('safeSearch')).toBe('strict');
    expect(requestUrl.searchParams.get('regionCode')).toBe('KR');
    expect(result!.source).toBe('YOUTUBE_SEARCH');
    expect(result!.videos[0]).toMatchObject({
      video_id: 'abcdEFGH123',
      title: "Tom & Jerry's 명상",
    });
    expect(redisClient.set).toHaveBeenCalledWith(
      'video-suggestions:v1:ko-KR:자기 연민 명상 10분',
      expect.any(String),
      'EX',
      86400,
    );
  });

  it('should use cached search results without calling YouTube', async () => {
    const cachedVideos = [
      {
        video_id: 'abcdEFGH123',
        title: '캐시',
        channel_title: null,
        thumbnail_url: 'https://i.ytimg.com/vi/abcdEFGH123/mqdefault.jpg',
        url: 'https://www.youtube.com/watch?v=abcdEFGH123',
      },
    ];
    const { service } = createMocks({
      checks: [check(2, 3, 2)],
      apiKey: 'key',
      cached: JSON.stringify(cachedVideos),
    });
    global.fetch = jest.fn();

    const result = await build(service);

    expect(result!.videos).toEqual(cachedVideos);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fall back to the search link when YouTube fails', async () => {
    const { service } = createMocks({
      checks: [check(2, 3, 2)],
      apiKey: 'key',
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const result = await build(service);

    expect(result!.source).toBe('SEARCH_LINK');
    expect(result!.videos).toEqual([]);
  });

  it('should record feedback with the user type code', async () => {
    const { service, prisma } = createMocks({});

    const result = await service.recordFeedback('user-1', {
      state: 'LOW_MOOD',
      action: 'DISMISSED',
    });

    expect(prisma.videoSuggestionFeedback.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        typeCode: 'INFP',
        state: 'LOW_MOOD',
        action: 'DISMISSED',
        videoId: null,
      },
    });
    expect(result).toMatchObject({
      id: 'feedback-new',
      state: 'LOW_MOOD',
      action: 'DISMISSED',
      created_at: NOW.toISOString(),
    });
  });

  it('should give each of the 16 types its own video copy for every state', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACK_DIR, 'manifest.json'), 'utf8'),
    ) as { available_types: string[] };
    const states = ['low_mood', 'unresponsive', 'overaroused'] as const;
    const titles = new Map<string, Set<string>>(
      states.map((state) => [state, new Set<string>()]),
    );

    expect(manifest.available_types).toHaveLength(16);

    for (const typeCode of manifest.available_types) {
      const profile = JSON.parse(
        readFileSync(join(PACK_DIR, `${typeCode}.json`), 'utf8'),
      );
      const copySet = profile.copy['ko-KR'].video_suggestions;

      for (const state of states) {
        const copy = copySet[state];

        expect(copy.title).toEqual(expect.any(String));
        expect(copy.body).toEqual(expect.any(String));
        expect(copy.search_query).toEqual(expect.any(String));
        expect(Array.isArray(copy.videos)).toBe(true);
        // 검색어에 유형명이 들어가면 유형 특징을 다루는 영상이 섞인다.
        expect(copy.search_query).not.toMatch(/[EI][SN][TF][JP]|MBTI/i);
        titles.get(state)!.add(copy.title);
      }
    }

    for (const state of states) {
      expect(titles.get(state)!.size).toBe(16);
    }
  });

  it('should not treat stale activity as a recent check window', async () => {
    const { service } = createMocks({ checks: [check(1, 1, 3 * 24 + 1)] });

    const result = await build(service, { inactiveDays: 4 });

    expect(result!.state).toBe('UNRESPONSIVE');
  });
});
