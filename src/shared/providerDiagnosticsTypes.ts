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
 * Ad-hoc LLM config to probe WITHOUT persisting settings — the first-run
 * setup form's in-progress values. `provider` mirrors
 * AppSettings['llmProvider']: 'openai' (OpenAI-compatible) or 'gemini'.
 */
export interface LlmProbeInput {
  provider: 'openai' | 'gemini';
  apiKey?: string;
  model?: string;
  /** OpenAI-compatible endpoint (provider 'openai'); falls back to OpenAI. */
  baseUrl?: string;
}

export type LlmProbeResult =
  | { ok: true; message: string; models?: string[] }
  | { ok: false; message: string; detail?: string };
