export type ComfyUIMode = 'inherit' | 'custom';
export type BackendMode = 'local' | 'cloud';
export type LLMProvider = 'lmstudio' | 'gemini' | 'openai' | 'openrouter';
export type ThemeId =
  | 'studio-neutral'
  | 'deep-forest-gold'
  | 'petroleum-clay'
  | 'paper-light'
  | 'void-cut';

export interface AccountInfo {
  /** User ID from Kshana Cloud. */
  userId: string;
  email: string;
  name?: string | null;
  /** Cached credit balance. Refresh through account IPC before display. */
  credits: number;
  planId?: string;
  planLabel?: string;
  subscriptionStatus?: string;
  /** Signed desktop JWT issued by the website. */
  token: string;
}

export interface AppSettings {
  /** Whether embedded kshana-core uses BYO settings or Kshana Cloud proxy credits. */
  backendMode: BackendMode;
  /** Whether to inherit backend COMFYUI_BASE_URL or use a desktop override URL. */
  comfyuiMode: ComfyUIMode;
  /** URL of the ComfyUI server the user wants to use. */
  comfyuiUrl: string;
  /** Comfy Cloud API key used when comfyuiUrl points at cloud.comfy.org. */
  comfyCloudApiKey: string;
  /** Fixed internally at 1800 seconds; not user-editable in UI. */
  comfyuiTimeout: number;
  /** LLM provider used by the bundled local backend. */
  llmProvider: LLMProvider;
  /** LM Studio base URL used by the bundled local backend. */
  lmStudioUrl: string;
  /** LM Studio model id used by the bundled local backend. */
  lmStudioModel: string;
  /** Google Gemini API key used by the bundled local backend. */
  googleApiKey: string;
  /** Gemini model id used by the bundled local backend. */
  geminiModel: string;
  /** OpenAI API key used by the bundled local backend. */
  openaiApiKey: string;
  /** OpenAI-compatible base URL used by the bundled local backend. */
  openaiBaseUrl: string;
  /** OpenAI model id used by the bundled local backend. */
  openaiModel: string;
  /** OpenRouter API key used by the bundled local backend. */
  openRouterApiKey: string;
  /** OpenRouter model id used by the bundled local backend. */
  openRouterModel: string;
  /** Global desktop theme selection. */
  themeId: ThemeId;
  projectDir?: string;
}
