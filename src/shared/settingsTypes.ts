export type ComfyUIMode = 'inherit' | 'custom';
export type BackendMode = 'local' | 'cloud';
/**
 * One backend lane (LLM or ComfyUI) routing target. The two lanes are
 * independent: a user can keep ComfyUI local while sending paid LLM
 * traffic through the metered dhee proxy, or vice versa.
 */
export type BackendLane = 'local' | 'cloud';
export type LLMProvider = 'lmstudio' | 'gemini' | 'openai' | 'openrouter';
export type ThemeId =
  | 'studio-neutral'
  | 'deep-forest-gold'
  | 'petroleum-clay'
  | 'paper-light'
  | 'void-cut';

/**
 * One LLM target (provider + the fields that provider needs). Used for the
 * Medium and Light tiers; the Heavy/primary tier still lives as flat fields
 * on AppSettings for backward-compat with persisted settings.
 *
 * Tiers map to LLMRouter purposes in dhee-core/src/core/llm/purposes.ts:
 *   - Heavy:  long-form prose (story, scenes, shot prompts, motion directives)
 *             AND the pi-agent orchestrator
 *   - Medium: structured JSON (scene breakdowns, prompt refinement, workflow analysis)
 *   - Light:  utility checks (continuity, image review, json repair)
 */
export interface LLMTierConfig {
  provider: 'gemini' | 'openai';
  // openai-compat (used when provider === 'openai')
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  // gemini (used when provider === 'gemini')
  googleApiKey: string;
  geminiModel: string;
}

export interface AccountInfo {
  /** User ID from dhee Cloud. */
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
  /**
   * Coarse "is at least one lane on cloud" indicator. Derived from
   * llmBackend / comfyBackend at normalize time (cloud if either is
   * cloud). Kept as a real field for back-compat with code paths
   * that gate on "are we using cloud at all" — sign-in flows,
   * landing screen badges, etc.
   */
  backendMode: BackendMode;
  /** LLM routing target. 'cloud' requires a valid dhee Cloud sign-in. */
  llmBackend: BackendLane;
  /** ComfyUI routing target. 'cloud' requires a valid dhee Cloud sign-in. */
  comfyBackend: BackendLane;
  /**
   * VLM (vision judge) routing target. Independent of llmBackend —
   * a user can keep LLM on cloud while running a self-hosted vision
   * model locally, or vice versa. 'cloud' requires a valid dhee
   * Cloud sign-in. Only consulted when vlmJudge=true.
   */
  vlmBackend: BackendLane;
  /** Whether to inherit backend COMFYUI_BASE_URL or use a desktop override URL. */
  comfyuiMode: ComfyUIMode;
  /** URL of the ComfyUI server the user wants to use. */
  comfyuiUrl: string;
  /** Comfy Cloud API key used when comfyuiUrl points at cloud.comfy.org. */
  comfyCloudApiKey: string;
  /**
   * Named ComfyUI endpoints — maps a semantic name (declared in a
   * DAG bundle's runner config) to the actual URL. Bundle stays
   * portable across users (uses names); per-user URLs live here.
   *
   * Conventional names:
   *   - `self.local`    — the user's own LAN box
   *   - `self.cloud`    — user's private cloud / paid subscription
   *   - `public.cloud`  — shared public Comfy Cloud
   *   - `peer.<id>`     — future P2P peers
   *
   * dheeCoreManager forwards every entry as `ENDPOINT_<name>` env var
   * (dots in the name → underscores in the key) before spawning the
   * kshana-core process. Empty / missing entries are not forwarded.
   *
   * Defaults to a record seeded with public.cloud (when normalized).
   * Optional in the type so legacy settings.json blobs without the
   * field still validate; the normalizer in settingsManager seeds the
   * defaults and the dheeCoreManager forwarder handles missing/empty.
   * The bundle resolver fails loud with a pointer to this setting
   * when a bundle references an unset endpoint.
   */
  comfyEndpoints?: Record<string, string>;
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
  /**
   * When true (default), the flat openai/gemini fields above are used for
   * every LLM call (heavy/medium/light). When false, the user supplies
   * separate Medium and Light tier configs and dhee-core's LLMRouter
   * routes per-purpose. The Heavy tier always reads from the flat fields.
   */
  llmUseSameForAllTiers: boolean;
  /** Medium-tier LLM (only consulted when llmUseSameForAllTiers === false). */
  llmTierMedium: LLMTierConfig;
  /** Light-tier LLM (only consulted when llmUseSameForAllTiers === false). */
  llmTierLight: LLMTierConfig;
  /** Global desktop theme selection. */
  themeId: ThemeId;
  projectDir?: string;
  /**
   * Pi-agent oversight: when true, pi-agent is auto-engaged on
   * runner events (failed / completed / per-asset-when-vlmJudge-on).
   * Global preference — applies to all projects. Quick-toggle in
   * the chat header writes to the same value as the Settings panel.
   * Default: true.
   */
  piOversight: boolean;
  /**
   * VLM master switch: gates all vision-LLM calls (the oversight
   * `describeImageWithVLM` AND the executor's legacy
   * `reviewImageWithVLM` retry-once gate). Effective only when
   * piOversight is also true — VLM standalone has no consumer.
   * Default: true.
   */
  vlmJudge: boolean;
  /**
   * VLM (vision judge) provider — independent of the LLM. When
   * llmBackend='cloud' AND vlmJudge=true, VLM auto-routes to the
   * dhee Cloud proxy (uses the desktop token); only vlmModel is
   * read in that mode. When llmBackend='local' the user supplies
   * baseUrl / apiKey / model. Empty values fall through to env so
   * dev users running from a dhee-core checkout with VLM_* in .env
   * still work without UI input.
   */
  vlmProvider: 'openai' | 'gemini';
  vlmBaseUrl: string;
  vlmApiKey: string;
  vlmModel: string;
}
