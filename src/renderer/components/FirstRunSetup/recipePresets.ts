/**
 * recipePresets — map a first-run "recipe" (a coherent way to run Dhee)
 * to the AppSettings patch that configures the three backend lanes
 * (LLM / ComfyUI / VLM). The wizard collects provider keys + the
 * ComfyUI URL as step inputs and assembles the final patch here, which
 * is applied in ONE settings:update so the embedded engine restarts once.
 */
import type { AppSettings, LLMProvider } from '../../../shared/settingsTypes';

export type Recipe = 'cloud' | 'hybrid' | 'local';

export interface LocalLlmConfig {
  provider: LLMProvider;
  /** OpenAI-compatible endpoint (provider='openai'). Optional key for local. */
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  googleApiKey?: string;
  geminiModel?: string;
}

export interface SetupInput {
  recipe: Recipe;
  /** Local ComfyUI URL (hybrid + local recipes). */
  comfyuiUrl?: string;
  /** Provider config (local recipe only). */
  llm?: LocalLlmConfig;
}

/** Which lanes are cloud vs local for each recipe. */
export function recipeLanePatch(recipe: Recipe): Partial<AppSettings> {
  switch (recipe) {
    case 'cloud':
      return { llmBackend: 'cloud', comfyBackend: 'cloud', vlmBackend: 'cloud' };
    case 'hybrid':
      return { llmBackend: 'cloud', comfyBackend: 'local', vlmBackend: 'cloud', comfyuiMode: 'custom' };
    case 'local':
      return { llmBackend: 'local', comfyBackend: 'local', vlmBackend: 'local', comfyuiMode: 'custom' };
  }
}

/** Provider-specific key/model fields for a local LLM. */
export function llmProviderPatch(c: LocalLlmConfig): Partial<AppSettings> {
  if (c.provider === 'gemini') {
    return {
      llmProvider: 'gemini',
      googleApiKey: c.googleApiKey ?? '',
      geminiModel: c.geminiModel ?? 'gemini-2.5-flash',
    };
  }
  // OpenAI-compatible (OpenAI / OpenRouter / local). Key optional for local.
  return {
    llmProvider: 'openai',
    openaiApiKey: c.openaiApiKey ?? '',
    openaiBaseUrl: c.openaiBaseUrl ?? 'https://api.openai.com/v1',
    openaiModel: c.openaiModel ?? 'gpt-4o',
  };
}

/** Assemble the full settings patch for a completed setup. */
export function buildSetupPatch(input: SetupInput): Partial<AppSettings> {
  let patch: Partial<AppSettings> = recipeLanePatch(input.recipe);
  if (input.recipe !== 'cloud' && input.comfyuiUrl) {
    patch = { ...patch, comfyuiUrl: input.comfyuiUrl };
  }
  if (input.recipe === 'local' && input.llm) {
    patch = { ...patch, ...llmProviderPatch(input.llm) };
  }
  return patch;
}
