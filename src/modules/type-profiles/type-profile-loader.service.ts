import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class TypeProfileLoaderService {
  private readonly manifestCache = new Map<string, JsonRecord>();
  private readonly profileCache = new Map<string, JsonRecord>();

  constructor(private readonly configService: ConfigService) {}

  async listVersions(): Promise<string[]> {
    const entries = await readdir(this.getDataRoot(), { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
  }

  async getManifest(version?: string): Promise<JsonRecord> {
    const resolvedVersion = version ?? (await this.getLatestVersion());
    const cacheKey = `manifest:${resolvedVersion}`;
    const cached = this.manifestCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const manifest = await this.readJson<JsonRecord>(
      join(this.getDataRoot(), resolvedVersion, 'manifest.json'),
    );

    this.manifestCache.set(cacheKey, manifest);

    return manifest;
  }

  async getProfile(typeCode: string, version?: string): Promise<JsonRecord> {
    const resolvedVersion = version ?? (await this.getLatestVersion());
    const normalizedTypeCode = typeCode.toUpperCase();
    const cacheKey = `${resolvedVersion}:${normalizedTypeCode}`;
    const cached = this.profileCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const profile = await this.readJson<JsonRecord>(
      join(this.getDataRoot(), resolvedVersion, `${normalizedTypeCode}.json`),
    );

    this.profileCache.set(cacheKey, profile);

    return profile;
  }

  private async getLatestVersion(): Promise<string> {
    const versions = await this.listVersions();
    const latestVersion = versions[0];

    if (!latestVersion) {
      throw new NotFoundException('No type profile pack was found.');
    }

    return latestVersion;
  }

  private getDataRoot(): string {
    return resolve(
      process.cwd(),
      this.configService.get<string>('TYPE_PROFILE_DATA_ROOT') ??
        'data/type-profiles',
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
          `Type profile asset was not found: ${filePath}`,
        );
      }

      throw error;
    }
  }
}
