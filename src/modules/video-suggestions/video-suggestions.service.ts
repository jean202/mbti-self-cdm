import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  VideoSuggestionAction,
  VideoSuggestionState,
} from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { RecordVideoSuggestionFeedbackDto } from './dto/record-video-suggestion-feedback.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_CHECK_WINDOW_MS = 3 * DAY_MS;
const SUPPORT_CHECK_WINDOW_MS = 7 * DAY_MS;
const UNRESPONSIVE_INACTIVE_DAYS = 3;
const LOW_MOOD_MAX_SCORE = 2;
const OVERAROUSED_MIN_ENERGY = 5;
const OVERAROUSED_MIN_MOOD = 4;
const PERSISTENT_LOW_MOOD_CHECKS = 3;
const DISMISS_COOLDOWN_MS = 3 * DAY_MS;
const OPENED_COOLDOWN_MS = DAY_MS;
const MAX_VIDEOS = 3;
const YOUTUBE_CACHE_TTL_SECONDS = 24 * 60 * 60;
const YOUTUBE_TIMEOUT_MS = 3000;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const STATE_COPY_KEY: Record<VideoSuggestionState, keyof VideoSuggestionCopySet> = {
  LOW_MOOD: 'low_mood',
  UNRESPONSIVE: 'unresponsive',
  OVERAROUSED: 'overaroused',
};

export interface CuratedVideo {
  video_id?: string;
  title?: string;
  channel_title?: string;
}

export interface VideoSuggestionCopy {
  title?: string;
  body?: string;
  search_query?: string;
  videos?: CuratedVideo[];
}

export interface VideoSuggestionCopySet {
  low_mood?: VideoSuggestionCopy;
  unresponsive?: VideoSuggestionCopy;
  overaroused?: VideoSuggestionCopy;
}

export interface SuggestedVideo {
  video_id: string;
  title: string | null;
  channel_title: string | null;
  thumbnail_url: string;
  url: string;
}

@Injectable()
export class VideoSuggestionsService {
  private readonly logger = new Logger(VideoSuggestionsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async buildSuggestion(input: {
    userId: string;
    typeCode: string;
    locale: string;
    copySet: VideoSuggestionCopySet | undefined;
    inactiveDays: number;
    now: Date;
  }) {
    const { userId, typeCode, locale, copySet, inactiveDays, now } = input;

    if (!copySet) {
      return null;
    }

    const checks = await this.prismaService.moodEnergyCheck.findMany({
      where: {
        userId,
        createdAt: { gte: new Date(now.getTime() - SUPPORT_CHECK_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { moodScore: true, energyScore: true, createdAt: true },
    });
    const state = this.detectState(checks, inactiveDays, now);

    if (!state) {
      return null;
    }

    const copy = copySet[STATE_COPY_KEY[state]];

    if (!copy?.title || !copy.body || !copy.search_query) {
      return null;
    }

    if (await this.isSuppressed(userId, state, now)) {
      return null;
    }

    const curated = this.toCuratedVideos(copy.videos);
    const searched =
      curated.length > 0
        ? []
        : await this.searchYouTube(copy.search_query, locale);
    const videos = curated.length > 0 ? curated : searched;

    return {
      state,
      type_code: typeCode,
      title: copy.title,
      body: copy.body,
      videos,
      search_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(copy.search_query)}`,
      source:
        curated.length > 0
          ? 'CURATED'
          : searched.length > 0
            ? 'YOUTUBE_SEARCH'
            : 'SEARCH_LINK',
      support_notice:
        state === VideoSuggestionState.LOW_MOOD &&
        this.isPersistentLowMood(checks)
          ? this.buildSupportNotice(locale)
          : null,
    };
  }

  async recordFeedback(userId: string, input: RecordVideoSuggestionFeedbackDto) {
    const mbtiProfile = await this.prismaService.mbtiProfile.findUnique({
      where: { userId },
      select: { typeCode: true },
    });
    const feedback = await this.prismaService.videoSuggestionFeedback.create({
      data: {
        userId,
        typeCode: mbtiProfile?.typeCode ?? null,
        state: input.state,
        action: input.action,
        videoId: input.video_id ?? null,
      },
    });

    return {
      id: feedback.id,
      state: feedback.state,
      action: feedback.action,
      video_id: feedback.videoId,
      created_at: feedback.createdAt.toISOString(),
    };
  }

  private detectState(
    checks: Array<{ moodScore: number; energyScore: number; createdAt: Date }>,
    inactiveDays: number,
    now: Date,
  ): VideoSuggestionState | null {
    const latest = checks[0];
    const latestIsRecent =
      latest && now.getTime() - latest.createdAt.getTime() <= RECENT_CHECK_WINDOW_MS;

    if (latestIsRecent && latest.moodScore <= LOW_MOOD_MAX_SCORE) {
      return VideoSuggestionState.LOW_MOOD;
    }

    if (
      latestIsRecent &&
      latest.energyScore >= OVERAROUSED_MIN_ENERGY &&
      latest.moodScore >= OVERAROUSED_MIN_MOOD
    ) {
      return VideoSuggestionState.OVERAROUSED;
    }

    if (inactiveDays >= UNRESPONSIVE_INACTIVE_DAYS) {
      return VideoSuggestionState.UNRESPONSIVE;
    }

    return null;
  }

  private isPersistentLowMood(checks: Array<{ moodScore: number }>) {
    return (
      checks.length >= PERSISTENT_LOW_MOOD_CHECKS &&
      checks
        .slice(0, PERSISTENT_LOW_MOOD_CHECKS)
        .every((check) => check.moodScore <= LOW_MOOD_MAX_SCORE)
    );
  }

  private async isSuppressed(
    userId: string,
    state: VideoSuggestionState,
    now: Date,
  ) {
    const recentFeedback = await this.prismaService.videoSuggestionFeedback.findFirst({
      where: {
        userId,
        state,
        OR: [
          {
            action: VideoSuggestionAction.DISMISSED,
            createdAt: { gte: new Date(now.getTime() - DISMISS_COOLDOWN_MS) },
          },
          {
            action: VideoSuggestionAction.OPENED,
            createdAt: { gte: new Date(now.getTime() - OPENED_COOLDOWN_MS) },
          },
        ],
      },
      select: { id: true },
    });

    return Boolean(recentFeedback);
  }

  private toCuratedVideos(videos: CuratedVideo[] | undefined): SuggestedVideo[] {
    return (videos ?? [])
      .filter(
        (video): video is CuratedVideo & { video_id: string } =>
          typeof video.video_id === 'string' &&
          YOUTUBE_VIDEO_ID_PATTERN.test(video.video_id),
      )
      .slice(0, MAX_VIDEOS)
      .map((video) =>
        this.toSuggestedVideo(
          video.video_id,
          video.title ?? null,
          video.channel_title ?? null,
        ),
      );
  }

  private async searchYouTube(
    query: string,
    locale: string,
  ): Promise<SuggestedVideo[]> {
    const apiKey = this.configService.get<string>('YOUTUBE_API_KEY');

    if (!apiKey) {
      return [];
    }

    const cacheKey = `video-suggestions:v1:${locale}:${query}`;
    const cached = await this.readCache(cacheKey);

    if (cached) {
      return cached;
    }

    const [language, region] = locale.split('-');
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: String(MAX_VIDEOS),
      q: query,
      safeSearch: 'strict',
      videoEmbeddable: 'true',
      relevanceLanguage: language || 'ko',
      regionCode: region || 'KR',
      key: apiKey,
    });

    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
        { signal: AbortSignal.timeout(YOUTUBE_TIMEOUT_MS) },
      );

      if (!response.ok) {
        this.logger.warn(`YouTube search failed with status ${response.status}.`);
        return [];
      }

      const body = (await response.json()) as {
        items?: Array<{
          id?: { videoId?: string };
          snippet?: { title?: string; channelTitle?: string };
        }>;
      };
      const videos = (body.items ?? [])
        .filter(
          (item) =>
            typeof item.id?.videoId === 'string' &&
            YOUTUBE_VIDEO_ID_PATTERN.test(item.id.videoId),
        )
        .slice(0, MAX_VIDEOS)
        .map((item) =>
          this.toSuggestedVideo(
            item.id!.videoId!,
            item.snippet?.title ? this.decodeHtmlEntities(item.snippet.title) : null,
            item.snippet?.channelTitle
              ? this.decodeHtmlEntities(item.snippet.channelTitle)
              : null,
          ),
        );

      if (videos.length > 0) {
        await this.writeCache(cacheKey, videos);
      }

      return videos;
    } catch (error) {
      this.logger.warn(
        `YouTube search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async readCache(key: string): Promise<SuggestedVideo[] | null> {
    try {
      const raw = await this.redisService.getClient().get(key);

      return raw ? (JSON.parse(raw) as SuggestedVideo[]) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, videos: SuggestedVideo[]) {
    try {
      await this.redisService
        .getClient()
        .set(key, JSON.stringify(videos), 'EX', YOUTUBE_CACHE_TTL_SECONDS);
    } catch {
      // 캐시 실패는 추천 자체를 막지 않는다.
    }
  }

  private toSuggestedVideo(
    videoId: string,
    title: string | null,
    channelTitle: string | null,
  ): SuggestedVideo {
    return {
      video_id: videoId,
      title,
      channel_title: channelTitle,
      thumbnail_url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  private decodeHtmlEntities(value: string) {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  private buildSupportNotice(locale: string) {
    if (!locale.startsWith('ko')) {
      return null;
    }

    return {
      title: '혼자 견디지 않아도 괜찮아요',
      body: '며칠째 마음이 많이 무거워 보여요. 이야기를 나눌 사람이 필요하다면 언제든 전문 상담을 받을 수 있어요.',
      contacts: [
        { label: '자살예방상담전화 (24시간)', phone: '109' },
        { label: '정신건강위기상담전화 (24시간)', phone: '1577-0199' },
      ],
    };
  }
}
