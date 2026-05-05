import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { describe, expect, it } from '@jest/globals';
import os from 'os';
import path from 'path';
import {
  resolveKshanaCoreUrl,
  resolveKshanaProxyBaseUrl,
  resolveKshanaWebsiteUrl,
  type RuntimeConfigSource,
} from './cloudRuntimeConfig';

async function makeSource(config?: unknown): Promise<RuntimeConfigSource> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'kshana-runtime-config-'));
  const dirname = path.join(tempDir, 'dist', 'main');
  const assetsDir = path.join(tempDir, 'assets');
  await mkdir(dirname, { recursive: true });
  await mkdir(assetsDir, { recursive: true });
  if (config) {
    await writeFile(
      path.join(assetsDir, 'runtime-config.json'),
      JSON.stringify(config),
      'utf-8',
    );
  }

  return {
    isPackaged: false,
    resourcesPath: path.join(tempDir, 'resources'),
    dirname,
    env: {},
  };
}

async function cleanup(source: RuntimeConfigSource) {
  await rm(path.resolve(source.dirname, '../..'), {
    recursive: true,
    force: true,
  });
}

describe('cloud runtime config', () => {
  it('keeps website and core URLs separate when both are configured in a file', async () => {
    const source = await makeSource({
      kshanaWebsiteUrl: 'https://website.example/',
      kshanaCoreUrl: 'https://core.example/',
    });

    try {
      await expect(resolveKshanaWebsiteUrl(source)).resolves.toBe(
        'https://website.example',
      );
      await expect(resolveKshanaCoreUrl(source)).resolves.toBe(
        'https://core.example',
      );
    } finally {
      await cleanup(source);
    }
  });

  it('uses env vars independently for website and core URLs', async () => {
    const source = await makeSource({
      kshanaWebsiteUrl: 'https://file-website.example',
      kshanaCoreUrl: 'https://file-core.example',
    });
    source.env = {
      KSHANA_CLOUD_URL: 'https://env-website.example/',
      KSHANA_CORE_URL: 'https://env-core.example/',
    };

    try {
      await expect(resolveKshanaWebsiteUrl(source)).resolves.toBe(
        'https://env-website.example',
      );
      await expect(resolveKshanaCoreUrl(source)).resolves.toBe(
        'https://env-core.example',
      );
    } finally {
      await cleanup(source);
    }
  });

  it('resolves proxy URL independently and falls back to website origin', async () => {
    const source = await makeSource({
      kshanaWebsiteUrl: 'https://website.example',
      kshanaProxyBaseUrl: 'https://proxy.example/',
    });

    try {
      await expect(resolveKshanaProxyBaseUrl(source)).resolves.toBe(
        'https://proxy.example',
      );
      source.env = { KSHANA_PROXY_BASE_URL: 'https://env-proxy.example/' };
      await expect(resolveKshanaProxyBaseUrl(source)).resolves.toBe(
        'https://env-proxy.example',
      );
    } finally {
      await cleanup(source);
    }
  });

  it('uses the website URL as the default proxy host', async () => {
    const source = await makeSource({
      kshanaWebsiteUrl: 'https://website.example',
    });

    try {
      await expect(resolveKshanaProxyBaseUrl(source)).resolves.toBe(
        'https://website.example',
      );
    } finally {
      await cleanup(source);
    }
  });

  it('does not use the website URL as the core backend URL', async () => {
    const source = await makeSource({
      kshanaWebsiteUrl: 'https://website.example',
    });

    try {
      await expect(resolveKshanaWebsiteUrl(source)).resolves.toBe(
        'https://website.example',
      );
      await expect(resolveKshanaCoreUrl(source)).resolves.toBeUndefined();
    } finally {
      await cleanup(source);
    }
  });

  it('supports legacy cloudServerUrl runtime-config key for core URL', async () => {
    const source = await makeSource({
      cloudServerUrl: 'https://legacy-core.example/',
    });

    try {
      await expect(resolveKshanaCoreUrl(source)).resolves.toBe(
        'https://legacy-core.example',
      );
    } finally {
      await cleanup(source);
    }
  });

  it('falls back to localhost for website auth but leaves core unconfigured', async () => {
    const source = await makeSource();

    try {
      await expect(resolveKshanaWebsiteUrl(source)).resolves.toBe(
        'http://localhost:3000',
      );
      await expect(resolveKshanaCoreUrl(source)).resolves.toBeUndefined();
    } finally {
      await cleanup(source);
    }
  });
});
