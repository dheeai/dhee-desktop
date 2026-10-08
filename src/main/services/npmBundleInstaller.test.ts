import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { gzipSync } from 'zlib';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
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

  it('installs a bundle via the standard dhee-bundle keyword + dhee.bundles convention', async () => {
    const targetBundlesDir = mkdtempSync(join(tmpdir(), 'dhee-bundles-kw-'));
    made.push(targetBundlesDir);
    // Multi-bundle layout: bundles/<id>/bundle.json (what we publish).
    const tarball = makeTarGz({
      'package/package.json': JSON.stringify({
        name: 'dhee-bundle-infographics',
        version: '0.1.0',
        keywords: ['dhee-bundle'],
        dhee: { bundles: './bundles' },
      }),
      'package/bundles/infographics/bundle.json': JSON.stringify({
        id: 'infographics',
        version: '0.1.0',
        goal: 'final_video',
        nodes: [],
      }),
      'package/bundles/infographics/prompts/outline.md': 'outline',
    });
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://registry.test/dhee-bundle-infographics') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            'dist-tags': { latest: '0.1.0' },
            versions: { '0.1.0': { dist: { tarball: 'https://registry.test/ig.tgz' } } },
          }),
        };
      }
      if (url === 'https://registry.test/ig.tgz') {
        return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(tarball) };
      }
      return { ok: false, status: 404 };
    });

    const result = await installDheeBundleFromNpm({
      packageSpec: 'dhee-bundle-infographics',
      registryUrl: 'https://registry.test',
      targetBundlesDir,
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, bundleId: 'infographics' });
    expect(
      statSync(join(targetBundlesDir, 'infographics', 'bundle.json')).isFile(),
    ).toBe(true);
    expect(
      readFileSync(join(targetBundlesDir, 'infographics', 'prompts/outline.md'), 'utf8'),
    ).toBe('outline');
  });

  it('installs a flat single-bundle package (dhee.bundles: ".") with bundle.json at root', async () => {
    const targetBundlesDir = mkdtempSync(join(tmpdir(), 'dhee-bundles-flat-'));
    made.push(targetBundlesDir);

    const tarball = makeTarGz({
      'package/package.json': JSON.stringify({
        name: '@dhee_ai/bundle-upsc-explainer',
        version: '0.1.1',
        keywords: ['dhee-bundle'],
        dhee: { bundles: '.' },
      }),
      'package/bundle.json': JSON.stringify({
        id: 'upsc_explainer',
        version: '0.1.1',
        goal: 'final_video',
        nodes: [],
      }),
      'package/prompts/outline.md': 'outline',
    });
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://registry.test/@dhee_ai%2fbundle-upsc-explainer') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            'dist-tags': { latest: '0.1.1' },
            versions: { '0.1.1': { dist: { tarball: 'https://registry.test/upsc.tgz' } } },
          }),
        };
      }
      if (url === 'https://registry.test/upsc.tgz') {
        return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(tarball) };
      }
      return { ok: false, status: 404 };
    });

    const result = await installDheeBundleFromNpm({
      packageSpec: '@dhee_ai/bundle-upsc-explainer',
      registryUrl: 'https://registry.test',
      targetBundlesDir,
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, bundleId: 'upsc_explainer' });
    expect(
      statSync(join(targetBundlesDir, 'upsc_explainer', 'bundle.json')).isFile(),
    ).toBe(true);
    expect(
      readFileSync(join(targetBundlesDir, 'upsc_explainer', 'prompts/outline.md'), 'utf8'),
    ).toBe('outline');
  });

  it('pulls external runner packages (+ deps) and skips built-in tools', async () => {
    const targetBundlesDir = mkdtempSync(join(tmpdir(), 'dhee-bundles-run-'));
    const runnersDir = mkdtempSync(join(tmpdir(), 'dhee-runners-'));
    made.push(targetBundlesDir, runnersDir);

    const bundleTar = makeTarGz({
      'package/package.json': JSON.stringify({
        name: 'dhee-bundle-infographics',
        version: '0.1.0',
        keywords: ['dhee-bundle'],
        dhee: { bundles: './bundles' },
      }),
      'package/bundles/infographics/bundle.json': JSON.stringify({
        id: 'infographics',
        goal: 'final_video',
        nodes: [],
        dependencies: {
          runnerPackages: {
            'comfy.tts': 'dhee-runner-tts', // external → pulled
            'comfy.tti': 'should-not-install', // built-in → skipped
          },
        },
      }),
    });
    const runnerTar = makeTarGz({
      'package/package.json': JSON.stringify({
        name: 'dhee-runner-tts',
        version: '0.1.0',
        keywords: ['dhee-runner'],
        dhee: { runners: './dist/index.js' },
        dependencies: { '@dhee_ai/runner-sdk': '^0.1.0' },
      }),
      'package/dist/index.js': 'export const runners = [];',
    });
    const sdkTar = makeTarGz({
      'package/package.json': JSON.stringify({
        name: '@dhee_ai/runner-sdk',
        version: '0.1.1',
      }),
      'package/dist/index.js': 'export const x = 1;',
    });

    const meta = (latest: string, tgz: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        'dist-tags': { latest },
        versions: { [latest]: { dist: { tarball: tgz } } },
      }),
    });
    const fetchImpl = jest.fn(async (url: string) => {
      switch (url) {
        case 'https://registry.test/dhee-bundle-infographics':
          return meta('0.1.0', 'https://registry.test/ig.tgz');
        case 'https://registry.test/ig.tgz':
          return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(bundleTar) };
        case 'https://registry.test/dhee-runner-tts':
          return meta('0.1.0', 'https://registry.test/tts.tgz');
        case 'https://registry.test/tts.tgz':
          return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(runnerTar) };
        case 'https://registry.test/@dhee_ai%2frunner-sdk':
          return meta('0.1.1', 'https://registry.test/sdk.tgz');
        case 'https://registry.test/sdk.tgz':
          return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(sdkTar) };
        default:
          return { ok: false, status: 404 };
      }
    });

    const result = await installDheeBundleFromNpm({
      packageSpec: 'dhee-bundle-infographics',
      registryUrl: 'https://registry.test',
      targetBundlesDir,
      runnersNodeModulesDir: runnersDir,
      builtinTools: ['comfy.tti', 'llm.generate', 'ffmpeg.concat'],
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // external runner pulled; built-in tool skipped
    expect(result.installedRunners).toEqual([
      { tool: 'comfy.tts', packageName: 'dhee-runner-tts', version: '0.1.0' },
    ]);
    expect(result.runnerErrors).toEqual([]);
    // runner package + its @dhee_ai/runner-sdk dep extracted with dist
    expect(statSync(join(runnersDir, 'dhee-runner-tts', 'dist/index.js')).isFile()).toBe(true);
    expect(statSync(join(runnersDir, '@dhee_ai', 'runner-sdk', 'dist/index.js')).isFile()).toBe(true);
    // the built-in tool's bogus package was never fetched
    expect(fetchImpl).not.toHaveBeenCalledWith('https://registry.test/should-not-install');
  });

  it('keeps already-installed runner packages instead of re-downloading them', async () => {
    const targetBundlesDir = mkdtempSync(join(tmpdir(), 'dhee-bundles-skip-'));
    const runnersDir = mkdtempSync(join(tmpdir(), 'dhee-runners-skip-'));
    made.push(targetBundlesDir, runnersDir);

    const bundleTar = makeTarGz({
      'package/package.json': JSON.stringify({
        name: 'dhee-bundle-infographics',
        version: '0.1.0',
        keywords: ['dhee-bundle'],
        dhee: { bundles: './bundles' },
      }),
      'package/bundles/infographics/bundle.json': JSON.stringify({
        id: 'infographics',
        goal: 'final_video',
        nodes: [],
        dependencies: { runnerPackages: { 'comfy.tts': 'dhee-runner-tts' } },
      }),
    });

    // Pre-install a locally-patched runner-sdk on disk (the dev scenario).
    const sentinel = '// LOCALLY PATCHED SDK';
    mkdirSync(join(runnersDir, '@dhee_ai', 'runner-sdk', 'dist'), { recursive: true });
    writeFileSync(
      join(runnersDir, '@dhee_ai', 'runner-sdk', 'package.json'),
      JSON.stringify({
        name: '@dhee_ai/runner-sdk',
        version: '0.1.4-patched',
        dependencies: {},
      }),
    );
    writeFileSync(
      join(runnersDir, '@dhee_ai', 'runner-sdk', 'dist/index.js'),
      sentinel,
    );

    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://registry.test/dhee-bundle-infographics') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            'dist-tags': { latest: '0.1.0' },
            versions: {
              '0.1.0': { dist: { tarball: 'https://registry.test/ig.tgz' } },
            },
          }),
        };
      }
      if (url === 'https://registry.test/ig.tgz') {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => asArrayBuffer(bundleTar),
        };
      }
      return { ok: false, status: 404 };
    });

    const result = await installDheeBundleFromNpm({
      packageSpec: 'dhee-bundle-infographics',
      registryUrl: 'https://registry.test',
      targetBundlesDir,
      runnersNodeModulesDir: runnersDir,
      builtinTools: ['comfy.tti', 'llm.generate'],
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    // The locally-patched SDK must survive untouched...
    expect(
      readFileSync(join(runnersDir, '@dhee_ai', 'runner-sdk', 'dist/index.js'), 'utf8'),
    ).toBe(sentinel);
    // ...and the registry must NOT have been hit for the already-installed SDK.
    expect(fetchImpl).not.toHaveBeenCalledWith(
      'https://registry.test/@dhee_ai%2frunner-sdk',
    );
  });

  it('pulls a platform-matching native optional dependency, skips other platforms', async () => {
    const targetBundlesDir = mkdtempSync(join(tmpdir(), 'dhee-bundles-opt-'));
    const runnersDir = mkdtempSync(join(tmpdir(), 'dhee-runners-opt-'));
    made.push(targetBundlesDir, runnersDir);

    // Native-binding package names for THIS host vs a deliberately wrong one.
    const platMap: Record<string, string> = { darwin: 'darwin', win32: 'win32', linux: 'linux' };
    const archMap: Record<string, string> = { x64: 'x64', arm64: 'arm64', arm: 'arm', ia32: 'ia32' };
    const matchName = `native-${platMap[process.platform]}-${archMap[process.arch]}`;
    const otherName =
      process.platform === 'win32' ? 'native-darwin-arm64' : 'native-win32-x64';

    const bundleTar = makeTarGz({
      'package/package.json': JSON.stringify({
        name: 'dhee-bundle-gfx',
        version: '0.1.0',
        keywords: ['dhee-bundle'],
        dhee: { bundles: '.' },
      }),
      'package/bundle.json': JSON.stringify({
        id: 'gfx',
        goal: 'final_video',
        nodes: [],
        dependencies: { runnerPackages: { 'video.graphics': 'dhee-runner-gfx' } },
      }),
    });
    const runnerTar = makeTarGz({
      'package/package.json': JSON.stringify({
        name: 'dhee-runner-gfx',
        version: '0.1.0',
        keywords: ['dhee-runner'],
        dhee: { runners: './index.js' },
        optionalDependencies: { [matchName]: '1.0.0', [otherName]: '1.0.0' },
      }),
      'package/index.js': 'export const runners = [];',
    });
    const nativeTar = makeTarGz({
      'package/package.json': JSON.stringify({ name: matchName, version: '1.0.0' }),
      'package/binding.node': 'binary',
    });

    const meta = (latest: string, tgz: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        'dist-tags': { latest },
        versions: { [latest]: { dist: { tarball: tgz } } },
      }),
    });
    const fetchImpl = jest.fn(async (url: string) => {
      switch (url) {
        case 'https://registry.test/dhee-bundle-gfx':
          return meta('0.1.0', 'https://registry.test/gfx.tgz');
        case 'https://registry.test/gfx.tgz':
          return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(bundleTar) };
        case 'https://registry.test/dhee-runner-gfx':
          return meta('0.1.0', 'https://registry.test/rgfx.tgz');
        case 'https://registry.test/rgfx.tgz':
          return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(runnerTar) };
        case `https://registry.test/${matchName}`:
          return meta('1.0.0', 'https://registry.test/native.tgz');
        case 'https://registry.test/native.tgz':
          return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(nativeTar) };
        default:
          return { ok: false, status: 404 };
      }
    });

    const result = await installDheeBundleFromNpm({
      packageSpec: 'dhee-bundle-gfx',
      registryUrl: 'https://registry.test',
      targetBundlesDir,
      runnersNodeModulesDir: runnersDir,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    // platform-matching native binding installed
    expect(statSync(join(runnersDir, matchName, 'binding.node')).isFile()).toBe(true);
    // the other-platform optional dep was never even fetched
    expect(fetchImpl).not.toHaveBeenCalledWith(`https://registry.test/${otherName}`);
  });
});
