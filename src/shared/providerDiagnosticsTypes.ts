export type ProviderDiagnosticStatus =
  | 'ready'
  | 'warning'
  | 'error'
  | 'unknown';

export type ProviderDiagnosticId = 'cloud-account' | 'comfyui' | 'llm' | 'vlm';

export interface ProviderDiagnosticItem {
  id: ProviderDiagnosticId;
  label: string;
  status: ProviderDiagnosticStatus;
  message: string;
  detail?: string;
}

export interface ProviderDiagnosticsSnapshot {
  checkedAt: number;
  items: ProviderDiagnosticItem[];
}

/**
 * Ad-hoc LLM config to probe WITHOUT persisting settings — the
 * first-run setup form's in-progress values. `provider` mirrors
 * AppSettings['llmProvider'].
 */
export interface LlmProbeInput {
  provider: 'openrouter' | 'openai' | 'gemini' | 'lmstudio';
  apiKey?: string;
  model?: string;
  /** Base URL for an OpenAI-compatible local server (provider 'lmstudio'). */
  lmStudioUrl?: string;
  /** Override base URL for the 'openai' provider; falls back to saved settings. */
  openaiBaseUrl?: string;
}

export type LlmProbeResult =
  | { ok: true; message: string }
  | { ok: false; message: string; detail?: string };
