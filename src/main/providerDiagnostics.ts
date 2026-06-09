/* eslint-disable compat/compat, import/prefer-default-export */
import type { AccountInfo, AppSettings } from '../shared/settingsTypes';
import type {
  LlmModelInfo,
  LlmProbeInput,
  LlmProbeResult,
  LlmWarmResult,
  ProviderDiagnosticItem,
  ProviderDiagnosticsSnapshot,
} from '../shared/providerDiagnosticsTypes';
import { getComfyUiUrl, withV1Suffix } from './utils/comfyUrl';
import { isLocalLlmUrl } from '../shared/localUrl';

const DEFAULT_TIMEOUT_MS = 3500;
const MODEL_WARM_TIMEOUT_MS = 180_000;
const GEMINI_MODELS_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

const isLocalBaseUrl = isLocalLlmUrl;

async function fetchOk(
  url: string,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    // eslint-disable-next-line compat/compat
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Parse model ids from an OpenAI-compatible GET /models body. Best-effort, capped. */
async function fetchModelIds(url: string, headers?: Record<string, string>): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    // eslint-disable-next-line compat/compat
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? [])
      .map((m) => (typeof m?.id === 'string' ? m.id : null))
      .filter((x): x is string => x !== null)
      .slice(0, 50);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Parse model ids + local server status from an OpenAI-compatible GET /models body. */
async function fetchModelDetails(url: string, headers?: Record<string, string>): Promise<LlmModelInfo[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    // eslint-disable-next-line compat/compat
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      data?: Array<{ id?: unknown; status?: { value?: unknown } | unknown }>;
    };
    return (body.data ?? [])
      .map((m) => {
        if (typeof m?.id !== 'string') return null;
        const status =
          typeof m.status === 'object' &&
          m.status !== null &&
          'value' in m.status &&
          typeof m.status.value === 'string'
            ? m.status.value
            : undefined;
        return { id: m.id, ...(status ? { status } : {}) };
      })
      .filter((x): x is LlmModelInfo => x !== null)
      .slice(0, 50);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGeminiModelIds(apiKey: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    // eslint-disable-next-line compat/compat
    const response = await fetch(
      `${GEMINI_MODELS_URL}?key=${encodeURIComponent(apiKey)}`,
      { method: 'GET', signal: controller.signal },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { models?: Array<{ name?: unknown }> };
    return (body.models ?? [])
      .map((m) => (typeof m?.name === 'string' ? m.name.replace(/^models\//, '') : null))
      .filter((x): x is string => x !== null)
      .slice(0, 50);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function cloudAccountDiagnostic(
  account: AccountInfo | null,
): ProviderDiagnosticItem {
  if (account) {
    return {
      id: 'cloud-account',
      label: 'Dhee Cloud account',
      status: 'ready',
      message: `Signed in as ${account.email}`,
    };
  }

  return {
    id: 'cloud-account',
    label: 'Dhee Cloud account',
    status: 'warning',
    message: 'Sign in to use Dhee Cloud credits.',
  };
}

async function comfyDiagnostic(
  settings: AppSettings,
  account: AccountInfo | null,
): Promise<ProviderDiagnosticItem> {
  if (settings.comfyBackend === 'cloud') {
    return account
      ? {
          id: 'comfyui',
          label: 'ComfyUI',
          status: 'ready',
          message: 'Configured for Dhee Cloud.',
        }
      : {
          id: 'comfyui',
          label: 'ComfyUI',
          status: 'warning',
          message: 'Cloud ComfyUI needs a Dhee account sign-in.',
        };
  }

  const url = getComfyUiUrl(settings);
  const result = await fetchOk(joinUrl(url, '/system_stats'));
  if (result.ok) {
    return {
      id: 'comfyui',
      label: 'ComfyUI',
      status: 'ready',
      message: `Reachable at ${url}`,
    };
  }

  return {
    id: 'comfyui',
    label: 'ComfyUI',
    status: 'warning',
    message: `Could not reach ComfyUI at ${url}.`,
    detail: result.status ? `HTTP ${result.status}` : result.error,
  };
}

async function llmDiagnostic(
  settings: AppSettings,
  account: AccountInfo | null,
): Promise<ProviderDiagnosticItem> {
  if (settings.llmBackend === 'cloud') {
    return account
      ? {
          id: 'llm',
          label: 'LLM',
          status: 'ready',
          message: 'Configured for Dhee Cloud.',
        }
      : {
          id: 'llm',
          label: 'LLM',
          status: 'warning',
          message: 'Cloud LLM needs a Dhee account sign-in.',
        };
  }

  if (settings.llmProvider === 'gemini') {
    if (!settings.googleApiKey.trim()) {
      return {
        id: 'llm',
        label: 'LLM',
        status: 'warning',
        message: 'Gemini needs a Google API key.',
      };
    }
    const result = await fetchOk(
      `${GEMINI_MODELS_URL}?key=${encodeURIComponent(settings.googleApiKey.trim())}`,
    );
    return result.ok
      ? {
          id: 'llm',
          label: 'LLM',
          status: 'ready',
          message: `Gemini key verified for ${settings.geminiModel || 'Gemini'}.`,
        }
      : {
          id: 'llm',
          label: 'LLM',
          status: 'warning',
          message:
            'Gemini configuration is present, but the key was not verified.',
          detail: result.status ? `HTTP ${result.status}` : result.error,
        };
  }

  // OpenAI-compatible endpoint (OpenAI / OpenRouter / local server). The
  // base URL fully determines the target; the key is OPTIONAL for local
  // endpoints (LM Studio / Ollama / llama.cpp / vLLM accept none) and
  // required only for remote ones.
  const baseUrl = withV1Suffix(settings.openaiBaseUrl || 'https://api.openai.com/v1');
  const apiKey = settings.openaiApiKey;
  const model = settings.openaiModel || 'gpt-4o';

  const localUrl = isLocalBaseUrl(baseUrl);
  const keyOptional = localUrl;
  if (!apiKey.trim() && !keyOptional) {
    return {
      id: 'llm',
      label: 'LLM',
      status: 'warning',
      message: 'This LLM provider needs an API key.',
    };
  }

  const headers = apiKey.trim()
    ? { Authorization: `Bearer ${apiKey.trim()}` }
    : undefined;
  const result = await fetchOk(joinUrl(baseUrl, '/models'), headers);
  if (result.ok) {
    return {
      id: 'llm',
      label: 'LLM',
      status: 'ready',
      message: `Model endpoint reachable for ${model}.`,
    };
  }

  return {
    id: 'llm',
    label: 'LLM',
    status: localUrl ? 'warning' : 'error',
    message: `Could not verify ${baseUrl}.`,
    detail: result.status ? `HTTP ${result.status}` : result.error,
  };
}

/**
 * Probe an LLM connection against AD-HOC config (the first-run setup
 * form's in-progress values) WITHOUT persisting settings. Shares the
 * exact endpoint convention as {@link llmDiagnostic}: GET /models on the
 * OpenAI-compatible base (or Gemini's models endpoint) — the cheapest
 * authenticated round-trip that proves key + reachability.
 *
 * The 'openai' provider is any OpenAI-compatible endpoint: point baseUrl
 * at OpenAI, OpenRouter, or a local LM Studio / Ollama (:11434) /
 * llama.cpp (:8080) / vLLM / LocalAI server — they all serve /v1/models.
 */
export async function probeLlm(input: LlmProbeInput): Promise<LlmProbeResult> {
  if (input.provider === 'gemini') {
    const key = (input.apiKey ?? '').trim();
    if (!key) {
      return { ok: false, message: 'Gemini needs a Google API key.' };
    }
    const result = await fetchOk(
      `${GEMINI_MODELS_URL}?key=${encodeURIComponent(key)}`,
    );
    const models = result.ok ? await fetchGeminiModelIds(key) : [];
    return result.ok
      ? {
          ok: true,
          message: models.length
            ? `Gemini key verified — ${models.length} models available.`
            : `Gemini key verified${input.model ? ` for ${input.model}` : ''}.`,
          models,
        }
      : {
          ok: false,
          message: 'Gemini key was not verified.',
          detail: result.status ? `HTTP ${result.status}` : result.error,
        };
  }

  // OpenAI-compatible endpoint. The base URL determines the target; the
  // key is optional for local endpoints, required for remote ones.
  const baseUrl = withV1Suffix(input.baseUrl || 'https://api.openai.com/v1');
  const apiKey = (input.apiKey ?? '').trim();
  const model = input.model || 'your model';

  const localUrl = isLocalBaseUrl(baseUrl);
  const keyOptional = localUrl;
  if (!apiKey && !keyOptional) {
    return { ok: false, message: 'This provider needs an API key.' };
  }

  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  const result = await fetchOk(joinUrl(baseUrl, '/models'), headers);
  if (!result.ok) {
    return {
      ok: false,
      message: `Could not reach ${baseUrl}.`,
      detail: result.status ? `HTTP ${result.status}` : result.error,
    };
  }
  // Reachable — enumerate the served models so the form can offer a picker
  // instead of a blank box.
  const modelDetails = await fetchModelDetails(joinUrl(baseUrl, '/models'), headers);
  const models = modelDetails.length
    ? modelDetails.map((m) => m.id)
    : await fetchModelIds(joinUrl(baseUrl, '/models'), headers);
  return {
    ok: true,
    message: models.length ? `Reachable — ${models.length} models available.` : `Model endpoint reachable for ${model}.`,
    models,
    ...(modelDetails.length ? { modelDetails } : {}),
  };
}

export async function warmLlmModel(input: LlmProbeInput): Promise<LlmWarmResult> {
  if (input.provider !== 'openai') {
    return { ok: false, message: 'Model loading is only available for local OpenAI-compatible endpoints.' };
  }

  const baseUrl = withV1Suffix(input.baseUrl || 'https://api.openai.com/v1');
  if (!isLocalBaseUrl(baseUrl)) {
    return { ok: false, message: 'Model loading is only triggered automatically for local endpoints.' };
  }

  const model = input.model?.trim();
  if (!model) return { ok: false, message: 'Choose a model before loading it.' };

  const apiKey = (input.apiKey ?? '').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_WARM_TIMEOUT_MS);
  try {
    // A tiny completion is the most portable load trigger across local
    // OpenAI-compatible servers. llama.cpp model-manager endpoints load
    // or swap the requested model before generating this response.
    // eslint-disable-next-line compat/compat
    const response = await fetch(joinUrl(baseUrl, '/chat/completions'), {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with ok.' }],
        max_tokens: 1,
        temperature: 0,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        message: `Could not load ${model}.`,
        detail: text || `HTTP ${response.status}`,
      };
    }
    return { ok: true, message: `${model} is loaded.` };
  } catch (error) {
    return {
      ok: false,
      message: `Could not load ${model}.`,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function vlmDiagnostic(
  settings: AppSettings,
  account: AccountInfo | null,
): Promise<ProviderDiagnosticItem> {
  if (!settings.vlmJudge) {
    return {
      id: 'vlm',
      label: 'VLM judge',
      status: 'unknown',
      message: 'VLM judge is turned off.',
    };
  }

  if (settings.vlmBackend === 'cloud') {
    return account
      ? {
          id: 'vlm',
          label: 'VLM judge',
          status: 'ready',
          message: 'Configured for Dhee Cloud.',
        }
      : {
          id: 'vlm',
          label: 'VLM judge',
          status: 'warning',
          message: 'Cloud VLM needs a Dhee account sign-in.',
        };
  }

  if (settings.vlmProvider === 'gemini') {
    const key = settings.vlmApiKey.trim();
    if (!key || !settings.vlmModel.trim()) {
      return {
        id: 'vlm',
        label: 'VLM judge',
        status: 'warning',
        message: 'Local VLM needs an API key and model.',
      };
    }
    const result = await fetchOk(
      `${GEMINI_MODELS_URL}?key=${encodeURIComponent(key)}`,
    );
    return result.ok
      ? {
          id: 'vlm',
          label: 'VLM judge',
          status: 'ready',
          message: `Gemini VLM verified for ${settings.vlmModel}.`,
        }
      : {
          id: 'vlm',
          label: 'VLM judge',
          status: 'warning',
          message: 'Gemini VLM key was not verified.',
          detail: result.status ? `HTTP ${result.status}` : result.error,
        };
  }

  const baseUrl = settings.vlmBaseUrl.trim();
  const apiKey = settings.vlmApiKey.trim();
  if (!baseUrl || !apiKey || !settings.vlmModel.trim()) {
    return {
      id: 'vlm',
      label: 'VLM judge',
      status: 'warning',
      message: 'Local VLM needs a base URL, API key, and model.',
    };
  }
  const probeUrl = withV1Suffix(baseUrl);
  const result = await fetchOk(joinUrl(probeUrl, '/models'), {
    Authorization: `Bearer ${apiKey}`,
  });
  return result.ok
    ? {
        id: 'vlm',
        label: 'VLM judge',
        status: 'ready',
        message: `VLM endpoint reachable for ${settings.vlmModel}.`,
      }
    : {
        id: 'vlm',
        label: 'VLM judge',
        status: isLocalBaseUrl(probeUrl) ? 'warning' : 'error',
        message: `Could not reach ${baseUrl}.`,
        detail: result.status ? `HTTP ${result.status}` : result.error,
      };
}

export async function runProviderDiagnostics(
  settings: AppSettings,
  account: AccountInfo | null,
): Promise<ProviderDiagnosticsSnapshot> {
  const [comfy, llm, vlm] = await Promise.all([
    comfyDiagnostic(settings, account),
    llmDiagnostic(settings, account),
    vlmDiagnostic(settings, account),
  ]);

  return {
    checkedAt: Date.now(),
    items: [cloudAccountDiagnostic(account), comfy, llm, vlm],
  };
}
