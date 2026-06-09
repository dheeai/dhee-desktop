import log from 'electron-log';
import type { AppSettings } from '../shared/settingsTypes';
import { isLocalLlmUrl } from '../shared/localUrl';
import { getComfyUiUrl, isComfyCloudUrl, withV1Suffix } from './utils/comfyUrl';

const COMFY_FREE_TIMEOUT_MS = 60_000;
const LLM_LOAD_TIMEOUT_MS = 180_000;
const LLM_UNLOAD_TIMEOUT_MS = 60_000;

function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function stripV1Suffix(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/v1\/?$/, '') || '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  }
}

function isSingleGpuLocalOpenAi(settings: AppSettings, baseUrlOverride?: string): boolean {
  if (settings.singleGpuMode !== true) return false;
  if (settings.llmBackend !== 'local') return false;
  if (settings.llmProvider !== 'openai') return false;
  return isLocalLlmUrl(withV1Suffix(baseUrlOverride || settings.openaiBaseUrl || ''));
}

function isSingleGpuLocalComfy(settings: AppSettings): boolean {
  if (settings.singleGpuMode !== true) return false;
  if (settings.comfyBackend !== 'local') return false;
  const comfyUrl = getComfyUiUrl(settings);
  return !isComfyCloudUrl(comfyUrl);
}

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<{ ok: true } | { ok: false; status?: number; text?: string; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // eslint-disable-next-line compat/compat
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const text = await response.text().catch(() => '');
    return { ok: false, status: response.status, text };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function freeComfyBeforeLocalLlm(settings: AppSettings): Promise<void> {
  if (!isSingleGpuLocalOpenAi(settings)) return;
  if (!isSingleGpuLocalComfy(settings)) return;

  const comfyUrl = getComfyUiUrl(settings);
  const result = await postJson(
    joinUrl(comfyUrl, '/free'),
    { unload_models: true, free_memory: true },
    COMFY_FREE_TIMEOUT_MS,
  );
  if (!result.ok) {
    log.warn('[single-gpu] ComfyUI /free failed before local LLM use', result);
  }
}

export async function loadLocalLlmModelForSingleGpu(
  settings: AppSettings,
  input: { model: string; baseUrl?: string; apiKey?: string },
): Promise<{ ok: true; message: string } | { ok: false; message: string; detail?: string }> {
  if (!isSingleGpuLocalOpenAi(settings, input.baseUrl)) {
    return { ok: false, message: 'Model loading is only triggered automatically for local OpenAI-compatible endpoints.' };
  }
  const trimmedModel = input.model.trim();
  if (!trimmedModel) return { ok: false, message: 'Choose a model before loading it.' };

  await freeComfyBeforeLocalLlm(settings);

  const baseUrl = withV1Suffix(input.baseUrl || settings.openaiBaseUrl || '');
  const managerBaseUrl = stripV1Suffix(baseUrl);
  const headers: Record<string, string> = {};
  const apiKey = input.apiKey ?? settings.openaiApiKey;
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  const result = await postJson(
    joinUrl(managerBaseUrl, '/models/load'),
    { model: trimmedModel },
    LLM_LOAD_TIMEOUT_MS,
    headers,
  );
  if (!result.ok) {
    return {
      ok: false,
      message: `Could not load ${trimmedModel}.`,
      detail: result.text || result.error || (result.status ? `HTTP ${result.status}` : undefined),
    };
  }
  return { ok: true, message: `${trimmedModel} is loaded.` };
}

export async function unloadLocalLlmBeforeLocalComfy(
  settings: AppSettings,
): Promise<void> {
  if (!isSingleGpuLocalOpenAi(settings)) return;
  if (!isSingleGpuLocalComfy(settings)) return;

  const model = settings.openaiModel.trim();
  if (!model) return;
  const baseUrl = withV1Suffix(settings.openaiBaseUrl || '');
  const managerBaseUrl = stripV1Suffix(baseUrl);
  const headers: Record<string, string> = {};
  if (settings.openaiApiKey.trim()) {
    headers.Authorization = `Bearer ${settings.openaiApiKey.trim()}`;
  }
  const result = await postJson(
    joinUrl(managerBaseUrl, '/models/unload'),
    { model },
    LLM_UNLOAD_TIMEOUT_MS,
    headers,
  );
  if (!result.ok) {
    log.warn('[single-gpu] LLM unload failed before local ComfyUI use', result);
  }
}
