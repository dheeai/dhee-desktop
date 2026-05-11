/**
 * Resolve the ComfyUI URL from AppSettings. Used by the embedded
 * dhee-ink integration (dheeCoreManager) and — until the legacy
 * cleanup lands — by localBackendManager.
 *
 * The settings model has two shapes:
 *   - `inherit`: use the dhee-ink default (env var or built-in)
 *   - `custom`: use the URL the user typed in the desktop's settings UI
 *
 * Extracted out of localBackendManager so the embedded code path
 * doesn't pull the spawn-mode logic into its dependency graph.
 */
import type { AppSettings } from '../../shared/settingsTypes';

const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8188';

export function getComfyUiUrl(settings: AppSettings): string {
  if (settings.comfyuiMode === 'custom') {
    const trimmed = settings.comfyuiUrl?.trim() ?? '';
    return trimmed || DEFAULT_COMFYUI_URL;
  }
  // 'inherit' — let dhee-ink's tools fall back to env var / built-in
  return settings.comfyuiUrl?.trim() || DEFAULT_COMFYUI_URL;
}

export function isComfyCloudUrl(url: string): boolean {
  // Use the URL parser instead of a regex. The previous
  // `/(^|\.)cloud\.comfy\.org/` matched bare hostnames and subdomains
  // (e.g. `cloud.comfy.org`, `eu.cloud.comfy.org`) but NOT a full URL
  // like `https://cloud.comfy.org/api` — the host is preceded by `//`
  // there, which neither anchor accepts. That left COMFY_MODE='local'
  // for cloud-URL settings, breaking the embedded image-gen path.
  try {
    return new URL(url).hostname.toLowerCase() === 'cloud.comfy.org';
  } catch {
    return false;
  }
}

export function withV1Suffix(url: string): string {
  return /\/v1\/?$/.test(url) ? url : `${url.replace(/\/$/, '')}/v1`;
}
