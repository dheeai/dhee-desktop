/* eslint-disable compat/compat, import/prefer-default-export */
import type { AccountInfo, AppSettings } from '../shared/settingsTypes';
import type {
  LlmProbeInput,
  LlmProbeResult,
  ProviderDiagnosticItem,
  ProviderDiagnosticsSnapshot,
} from '../shared/providerDiagnosticsTypes';
import { getComfyUiUrl, withV1Suffix } from './utils/comfyUrl';

const DEFAULT_TIMEOUT_MS = 3500;
const GEMINI_MODELS_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

function joinUrl(base: string, pathname: string): string {
  return `${base.replace(/\/$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function isLocalBaseUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

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

  let baseUrl = settings.openaiBaseUrl || 'https://api.openai.com/v1';
  let apiKey = settings.openaiApiKey;
  let model = settings.openaiModel || 'gpt-4o';

  if (settings.llmProvider === 'openrouter') {
    baseUrl = 'https://openrouter.ai/api/v1';
    apiKey = settings.openRouterApiKey;
    model = settings.openRouterModel || model;
  } else if (settings.llmProvider === 'lmstudio') {
    baseUrl = withV1Suffix(settings.lmStudioUrl || 'http://127.0.0.1:1234');
    apiKey = '';
    model = settings.lmStudioModel || 'LM Studio';
  }

  const localUrl = isLocalBaseUrl(baseUrl);
  if (!apiKey.trim() && !localUrl) {
    return {
      id: 'llm',
      label: 'LLM',
      status: 'warning',
      message: 'OpenAI-compatible LLM needs an API key.',
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
 * The 'lmstudio' provider is just "an OpenAI-compatible local server":
 * point lmStudioUrl at LM Studio, Ollama (:11434), llama.cpp server
 * (:8080), vLLM, LocalAI, etc. — they all serve GET /v1/models.
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
    return result.ok
      ? {
          ok: true,
          message: `Gemini key verified${input.model ? ` for ${input.model}` : ''}.`,
        }
      : {
          ok: false,
          message: 'Gemini key was not verified.',
          detail: result.status ? `HTTP ${result.status}` : result.error,
        };
  }

  let baseUrl = input.openaiBaseUrl || 'https://api.openai.com/v1';
  let apiKey = (input.apiKey ?? '').trim();
  let model = input.model || 'gpt-4o';
  if (input.provider === 'openrouter') {
    baseUrl = 'https://openrouter.ai/api/v1';
    model = input.model || model;
  } else if (input.provider === 'lmstudio') {
    baseUrl = withV1Suffix(input.lmStudioUrl || 'http://127.0.0.1:1234');
    apiKey = '';
    model = input.model || 'your local model';
  }

  const localUrl = isLocalBaseUrl(baseUrl);
  if (!apiKey && !localUrl) {
    return { ok: false, message: 'This provider needs an API key.' };
  }

  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  const result = await fetchOk(joinUrl(baseUrl, '/models'), headers);
  return result.ok
    ? { ok: true, message: `Model endpoint reachable for ${model}.` }
    : {
        ok: false,
        message: `Could not reach ${baseUrl}.`,
        detail: result.status ? `HTTP ${result.status}` : result.error,
      };
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
