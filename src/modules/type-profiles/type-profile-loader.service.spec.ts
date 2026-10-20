import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TypeProfileLoaderService } from './type-profile-loader.service';

function createService(dataRoot?: string) {
  return new TypeProfileLoaderService({
    get: jest.fn((key: string) =>
      key === 'TYPE_PROFILE_DATA_ROOT' ? dataRoot : undefined,
    ),
  } as unknown as ConfigService);
}

describe('TypeProfileLoaderService', () => {
  it('loads the bundled manifest and every profile it lists', async () => {
    const service = createService();

    const manifest = await service.getManifest();
    const types = manifest.available_types as string[];

    expect(types).toHaveLength(16);
    for (const typeCode of types) {
      const profile = await service.getProfile(typeCode);
      expect(profile.type_code).toBe(typeCode);
    }
  });

  it('normalizes the type code case', async () => {
    const service = createService();

    const profile = await service.getProfile('infp', '2026-03-v1');

    expect(profile.type_code).toBe('INFP');
  });

  describe('with a custom data root', () => {
    let dataRoot: string;

    beforeEach(() => {
      dataRoot = mkdtempSync(join(tmpdir(), 'type-profiles-'));
    });

    afterEach(() => {
      rmSync(dataRoot, { recursive: true, force: true });
    });

    function writePack(version: string, files: Record<string, unknown>) {
      mkdirSync(join(dataRoot, version), { recursive: true });
      for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dataRoot, version, name), JSON.stringify(body));
      }
    }

    it('picks the newest pack directory by default and ignores loose files', async () => {
      writePack('2026-01-v1', { 'manifest.json': { profile_version: '2026-01-v1' } });
      writePack('2026-06-v1', { 'manifest.json': { profile_version: '2026-06-v1' } });
      writeFileSync(join(dataRoot, 'zzz-notes.json'), '{}');

      const service = createService(dataRoot);

      expect(await service.listVersions()).toEqual(['2026-06-v1', '2026-01-v1']);
      expect((await service.getManifest()).profile_version).toBe('2026-06-v1');
    });

    it('serves an explicitly requested older pack', async () => {
      writePack('2026-01-v1', { 'INFP.json': { type_code: 'INFP', marker: 'old' } });
      writePack('2026-06-v1', { 'INFP.json': { type_code: 'INFP', marker: 'new' } });

      const service = createService(dataRoot);

      expect((await service.getProfile('INFP', '2026-01-v1')).marker).toBe('old');
      expect((await service.getProfile('INFP')).marker).toBe('new');
    });

    it('caches manifests and profiles after the first read', async () => {
      writePack('v1', {
        'manifest.json': { profile_version: 'v1' },
        'ENTJ.json': { type_code: 'ENTJ', marker: 'first' },
      });
      const service = createService(dataRoot);

      await service.getManifest('v1');
      await service.getProfile('ENTJ', 'v1');
      writePack('v1', {
        'manifest.json': { profile_version: 'changed' },
        'ENTJ.json': { type_code: 'ENTJ', marker: 'changed' },
      });

      expect((await service.getManifest('v1')).profile_version).toBe('v1');
      expect((await service.getProfile('ENTJ', 'v1')).marker).toBe('first');
    });

    it('reports a missing profile as not found', async () => {
      writePack('v1', { 'manifest.json': {} });

      await expect(
        createService(dataRoot).getProfile('ISTP', 'v1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fails clearly when no pack exists', async () => {
      await expect(createService(dataRoot).getManifest()).rejects.toThrow(
        'No type profile pack was found.',
      );
    });

    it('surfaces invalid JSON instead of treating it as missing', async () => {
      mkdirSync(join(dataRoot, 'v1'));
      writeFileSync(join(dataRoot, 'v1', 'manifest.json'), '{ broken');

      await expect(createService(dataRoot).getManifest('v1')).rejects.toBeInstanceOf(
        SyntaxError,
      );
    });
  });
});
