import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { gzipSync } from 'zlib';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  installDheeBundleFromNpm,
  parsePackageSpec,
} from './npmBundleInstaller';

function tarString(value: string, length: number): Buffer {
  const out = Buffer.alloc(length);
  Buffer.from(value).copy(
    out,
    0,
    0,
    Math.min(Buffer.byteLength(value), length),
  );
  return out;
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  tarString(name, 100).copy(header, 0);
  tarString('0000777\0', 8).copy(header, 100);
  tarString('0000000\0', 8).copy(header, 108);
  tarString('0000000\0', 8).copy(header, 116);
  tarString(`${size.toString(8).padStart(11, '0')}\0`, 12).copy(header, 124);
  tarString('00000000000\0', 12).copy(header, 136);
  Buffer.from('        ').copy(header, 148);
  tarString('0', 1).copy(header, 156);
  tarString('ustar\0', 6).copy(header, 257);
  const sum = Array.from(header).reduce((total, byte) => total + byte, 0);
  tarString(`${sum.toString(8).padStart(6, '0')}\0 `, 8).copy(header, 148);
  return header;
}

function makeTarGz(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  Object.entries(entries).forEach(([name, content]) => {
    const data = Buffer.from(content, 'utf8');
    parts.push(tarHeader(name, data.length));
    parts.push(data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  });
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

function asArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

describe('npm Dhee bundle installer', () => {
  const made: string[] = [];

  afterEach(() => {
    made.splice(0).forEach((dir) => {
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('parses scoped package specs with and without explicit versions', () => {
    expect(parsePackageSpec('@dhee_ai/youtube-short-bundle')).toEqual({
      packageName: '@dhee_ai/youtube-short-bundle',
    });
    expect(parsePackageSpec('@dhee_ai/youtube-short-bundle@0.1.0')).toEqual({
      packageName: '@dhee_ai/youtube-short-bundle',
      requestedVersion: '0.1.0',
    });
  });

  it('downloads, validates, and extracts the declared Dhee bundle directory', async () => {
    const targetBundlesDir = mkdtempSync(
      join(tmpdir(), 'dhee-desktop-bundles-'),
    );
    made.push(targetBundlesDir);
    const tarball = makeTarGz({
      'package/package.json': JSON.stringify({
        name: '@dhee_ai/youtube-short-bundle',
        version: '0.1.0',
        dhee: {
          type: 'bundle',
          bundleId: 'youtube_short_text_video',
          bundleDir: './bundle',
        },
      }),
      'package/bundle/bundle.json': JSON.stringify({
        id: 'youtube_short_text_video',
        version: '0.1.0',
        displayName: 'YouTube Short',
        summary: 'Short-form vertical video.',
        goal: 'final_video',
        nodes: [],
      }),
      'package/bundle/prompts/hook.md': 'hook prompt',
    });

    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://registry.test/@dhee_ai%2fyoutube-short-bundle') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: '@dhee_ai/youtube-short-bundle',
            'dist-tags': { latest: '0.1.0' },
            versions: {
              '0.1.0': {
                dist: { tarball: 'https://registry.test/youtube-short.tgz' },
              },
            },
          }),
        };
      }
      if (url === 'https://registry.test/youtube-short.tgz') {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => asArrayBuffer(tarball),
        };
      }
      return { ok: false, status: 404 };
    });

    const result = await installDheeBundleFromNpm({
      packageSpec: '@dhee_ai/youtube-short-bundle',
      registryUrl: 'https://registry.test',
      targetBundlesDir,
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      packageName: '@dhee_ai/youtube-short-bundle',
      version: '0.1.0',
      bundleId: 'youtube_short_text_video',
    });
    const bundleDir = join(targetBundlesDir, 'youtube_short_text_video');
    expect(statSync(join(bundleDir, 'bundle.json')).isFile()).toBe(true);
    expect(readFileSync(join(bundleDir, 'prompts/hook.md'), 'utf8')).toBe(
      'hook prompt',
    );
  });

  it('extracts declared runner directories and returns their credential requirements', async () => {
    const targetBundlesDir = mkdtempSync(
      join(tmpdir(), 'dhee-desktop-bundles-'),
    );
    const targetRunnersDir = mkdtempSync(
      join(tmpdir(), 'dhee-desktop-runners-'),
    );
    made.push(targetBundlesDir, targetRunnersDir);
    const tarball = makeTarGz({
      'package/package.json': JSON.stringify({
        name: '@dhee_ai/fal-youtube-short-pack',
        version: '0.1.0',
        dhee: {
          type: 'bundle',
          bundleId: 'fal_youtube_short',
          bundleDir: './bundle',
          runnerDirs: ['./runners/fal-image'],
        },
      }),
      'package/bundle/bundle.json': JSON.stringify({
        id: 'fal_youtube_short',
        version: '0.1.0',
        displayName: 'Fal Short',
        summary: 'Short-form video with fal.ai.',
        dependencies: { runners: { 'fal.image': '>=0.1.0' } },
        goal: 'final_video',
        nodes: [],
      }),
      'package/runners/fal-image/runner.json': JSON.stringify({
        tool: 'fal.image',
        version: '0.1.0',
        engineCompat: '>=0.1.0',
        credentials: ['FAL_KEY'],
        displayName: 'fal.ai image',
        entry: 'dist/index.js',
      }),
      'package/runners/fal-image/dist/index.js': 'export const runner = {};',
    });

    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://registry.test/@dhee_ai%2ffal-youtube-short-pack') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: '@dhee_ai/fal-youtube-short-pack',
            'dist-tags': { latest: '0.1.0' },
            versions: {
              '0.1.0': {
                dist: { tarball: 'https://registry.test/fal-pack.tgz' },
              },
            },
          }),
        };
      }
      if (url === 'https://registry.test/fal-pack.tgz') {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => asArrayBuffer(tarball),
        };
      }
      return { ok: false, status: 404 };
    });

    const result = await installDheeBundleFromNpm({
      packageSpec: '@dhee_ai/fal-youtube-short-pack',
      registryUrl: 'https://registry.test',
      targetBundlesDir,
      targetRunnersDir,
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      bundleId: 'fal_youtube_short',
      runners: [
        {
          tool: 'fal.image',
          version: '0.1.0',
          credentials: ['FAL_KEY'],
          displayName: 'fal.ai image',
        },
      ],
    });
    const runnerDir = join(targetRunnersDir, 'fal-image');
    expect(statSync(join(runnerDir, 'runner.json')).isFile()).toBe(true);
    expect(statSync(join(runnerDir, 'dist/index.js')).isFile()).toBe(true);
  });
});
