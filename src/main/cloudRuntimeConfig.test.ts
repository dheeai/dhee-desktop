import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  applyRuntimeAnalyticsConfig,
  resolvedheeWebsiteUrl,
  type RuntimeConfigSource,
} from './cloudRuntimeConfig';

async function createSource(
  config: Record<string, unknown>,
): Promise<RuntimeConfigSource> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dhee-runtime-config-'));
  const assetsDir = path.join(root, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(
    path.join(assetsDir, 'runtime-config.json'),
    JSON.stringify(config),
  );
  return {
    isPackaged: true,
    resourcesPath: root,
    dirname: root,
    env: {},
  };
}

describe('cloud runtime config', () => {
  it('applies PostHog runtime settings for desktop and embedded core', async () => {
    const source = await createSource({
      posthogApiKey: 'phc_runtime',
      posthogHost: 'https://us.i.posthog.com',
      analyticsSalt: 'salt-1',
    });

    await applyRuntimeAnalyticsConfig(source);

    expect(source.env.POSTHOG_API_KEY).toBe('phc_runtime');
    expect(source.env.POSTHOG_HOST).toBe('https://us.i.posthog.com');
    expect(source.env.ANALYTICS_SALT).toBe('salt-1');
  });

  it('uses runtime website URL aliases', async () => {
    const source = await createSource({
      websiteUrl: 'http://localhost:3000/',
    });

    await expect(resolvedheeWebsiteUrl(source)).resolves.toBe(
      'http://localhost:3000',
    );
  });
});
