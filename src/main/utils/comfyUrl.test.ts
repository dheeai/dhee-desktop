import { describe, expect, it } from '@jest/globals';
import { isComfyCloudUrl, getComfyUiUrl } from './comfyUrl';
import type { AppSettings } from '../../shared/settingsTypes';

/**
 * Regression: `isComfyCloudUrl` was implemented with the regex
 * `/(^|\.)cloud\.comfy\.org/` which requires the host to be preceded
 * by start-of-string or a literal `.`. A full URL like
 * `https://cloud.comfy.org/api` has `//` before the host — neither
 * anchor matches, so the regex returned `false`. That made
 * `applyEnvFromSettings` set `COMFY_MODE='local'` for cloud-URL
 * users, which silently routed image gen to localhost.
 *
 * Fix: parse with `new URL(...)` and compare hostnames. These cases
 * pin the parser-based behavior.
 */
describe('isComfyCloudUrl', () => {
  it('matches a full URL with /api suffix (the production setting shape)', () => {
    expect(isComfyCloudUrl('https://cloud.comfy.org/api')).toBe(true);
  });

  it('matches a full URL without /api suffix', () => {
    expect(isComfyCloudUrl('https://cloud.comfy.org')).toBe(true);
  });

  it('matches http (not just https)', () => {
    expect(isComfyCloudUrl('http://cloud.comfy.org/api')).toBe(true);
  });

  it('does NOT match a different host that contains the substring', () => {
    // Hostname-only matching — the old regex would happily match
    // `evil-cloud.comfy.org.attacker.com` because the regex anchored
    // on the substring. URL parser checks the full hostname.
    expect(isComfyCloudUrl('https://cloud.comfy.org.attacker.com')).toBe(
      false,
    );
  });

  it('does NOT match a local URL', () => {
    expect(isComfyCloudUrl('http://localhost:8188')).toBe(false);
    expect(isComfyCloudUrl('http://127.0.0.1:8188')).toBe(false);
  });

  it('does NOT match a zrok or other tunnel', () => {
    expect(isComfyCloudUrl('https://comfyui.share.zrok.io')).toBe(false);
  });

  it('returns false for malformed URLs without throwing', () => {
    expect(isComfyCloudUrl('not a url at all')).toBe(false);
    expect(isComfyCloudUrl('')).toBe(false);
  });
});

describe('getComfyUiUrl + isComfyCloudUrl integration', () => {
  it('settings with custom cloud URL flow through to a cloud match', () => {
    const settings = {
      comfyuiMode: 'custom',
      comfyuiUrl: 'https://cloud.comfy.org/api',
      comfyCloudApiKey: 'k',
    } as Partial<AppSettings> as AppSettings;

    const url = getComfyUiUrl(settings);
    expect(url).toBe('https://cloud.comfy.org/api');
    expect(isComfyCloudUrl(url)).toBe(true);
  });
});
