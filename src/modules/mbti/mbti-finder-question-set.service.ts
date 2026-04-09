import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

export type MbtiFinderAxis = 'EI' | 'SN' | 'TF' | 'JP';

export interface MbtiFinderQuestion {
  id: string;
  prompt: string;
  order: number;
  axis: MbtiFinderAxis;
  direction: 1 | -1;
}

export interface MbtiFinderQuestionSet {
  questionSetVersion: string;
  scale: number[];
  questions: MbtiFinderQuestion[];
}

interface MbtiFinderQuestionSetFile {
  question_set_version?: string;
  scale?: unknown;
  questions?: unknown;
}

@Injectable()
export class MbtiFinderQuestionSetService {
  private readonly cache = new Map<string, MbtiFinderQuestionSet>();

  constructor(private readonly configService: ConfigService) {}

  async getQuestionSet(version?: string): Promise<MbtiFinderQuestionSet> {
    const resolvedVersion = version ?? (await this.getLatestVersion());
    const cached = this.cache.get(resolvedVersion);

    if (cached) {
      return cached;
    }

    const raw = (await this.readJson(
      join(this.getDataRoot(), `${resolvedVersion}.json`),
    )) as MbtiFinderQuestionSetFile;
    const scale =
      Array.isArray(raw.scale) &&
      raw.scale.every(
        (value): value is number =>
          typeof value === 'number' && Number.isInteger(value),
      )
        ? raw.scale
        : [1, 2, 3, 4, 5];
    const questions = Array.isArray(raw.questions)
      ? raw.questions
          .filter(
            (value): value is MbtiFinderQuestion =>
              typeof value === 'object' &&
              value !== null &&
              'id' in value &&
              typeof value.id === 'string' &&
              'prompt' in value &&
              typeof value.prompt === 'string' &&
              'order' in value &&
              typeof value.order === 'number' &&
              'axis' in value &&
              (value.axis === 'EI' ||
                value.axis === 'SN' ||
                value.axis === 'TF' ||
                value.axis === 'JP') &&
              'direction' in value &&
              (value.direction === 1 || value.direction === -1),
          )
          .sort((left, right) => left.order - right.order)
      : [];

    if (questions.length === 0) {
      throw new NotFoundException(
        `MBTI finder question set is invalid: ${resolvedVersion}`,
      );
    }

    const questionSet: MbtiFinderQuestionSet = {
      questionSetVersion:
        typeof raw.question_set_version === 'string'
          ? raw.question_set_version
          : resolvedVersion,
      scale,
      questions,
    };

    this.cache.set(resolvedVersion, questionSet);

    return questionSet;
  }

  async listVersions(): Promise<string[]> {
    const entries = await readdir(this.getDataRoot(), { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && extname(entry.name) === '.json')
      .map((entry) => entry.name.replace(/\.json$/, ''))
      .sort((left, right) => right.localeCompare(left));
  }

  private async getLatestVersion(): Promise<string> {
    const versions = await this.listVersions();
    const latestVersion = versions[0];

    if (!latestVersion) {
      throw new NotFoundException('No MBTI finder question set was found.');
    }

    return latestVersion;
  }

  private getDataRoot(): string {
    return resolve(
      process.cwd(),
      this.configService.get<string>('MBTI_FINDER_DATA_ROOT') ??
        'data/mbti-finder-question-sets',
    );
  }

  private async readJson<T>(filePath: string): Promise<T> {
    try {
      const raw = await readFile(filePath, 'utf8');

      return JSON.parse(raw) as T;
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : undefined;

      if (code === 'ENOENT') {
        throw new NotFoundException(
          `MBTI finder question set was not found: ${filePath}`,
        );
      }

      throw error;
    }
  }
}
