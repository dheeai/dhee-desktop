import { afterEach, beforeEach, describe, expect, it, vi } from '@jest/globals';
import {
  __isComfyCloudFetchAuthInstalledForTesting,
  installComfyCloudFetchAuth,
  uninstallComfyCloudFetchAuthForTesting,
} from './comfyCloudFetchAuth';

const ENV_KEYS = ['COMFY_MODE', 'COMFY_CLOUD_API_KEY', 'COMFYUI_BASE_URL', 'ENDPOINT_public_cloud'] as const;

describe('installComfyCloudFetchAuth', () => {
  let saved: Record<string, string | undefined>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    uninstallComfyCloudFetchAuthForTesting();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    uninstallComfyCloudFetchAuthForTesting();
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('injects Bearer for Dhee Cloud proxy URLs in cloud mode', async () => {
    process.env.COMFY_MODE = 'cloud';
    process.env.COMFY_CLOUD_API_KEY = 'desktop-jwt';
    process.env.COMFYUI_BASE_URL = 'https://dhee.studio/comfy/api';

    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch as typeof fetch;

    installComfyCloudFetchAuth();
    expect(__isComfyCloudFetchAuthInstalledForTesting()).toBe(true);

    await globalThis.fetch('https://dhee.studio/comfy/api/upload/image', { method: 'POST' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer desktop-jwt');
  });

  it('does not inject auth for localhost Comfy in local mode', async () => {
    process.env.COMFY_MODE = 'local';
    process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';

    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch as typeof fetch;

    installComfyCloudFetchAuth();
    await globalThis.fetch('http://127.0.0.1:8188/upload/image', { method: 'POST' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit | undefined];
    const headers = init?.headers as Headers | undefined;
    expect(headers?.get?.('Authorization')).toBeUndefined();
  });

  it('uses X-API-Key for direct cloud.comfy.org in cloud mode', async () => {
    process.env.COMFY_MODE = 'cloud';
    process.env.COMFY_CLOUD_API_KEY = 'comfy-key';

    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch as typeof fetch;

    installComfyCloudFetchAuth();
    await globalThis.fetch('https://cloud.comfy.org/api/prompt', { method: 'POST' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('X-API-Key')).toBe('comfy-key');
  });
});
