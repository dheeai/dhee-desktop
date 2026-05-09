import Store from 'electron-store';
import type {
  AppSettings,
  BackendLane,
  BackendMode,
  ComfyUIMode,
  LLMProvider,
  LLMTierConfig,
  ThemeId,
} from '../shared/settingsTypes';

const FIXED_COMFYUI_TIMEOUT_SECONDS = 1800;
const LEGACY_LOCAL_COMFYUI_URL = 'http://localhost:8000';
const DEFAULT_THEME_ID: ThemeId = 'studio-neutral';
const DEFAULT_LM_STUDIO_URL = 'http://127.0.0.1:1234';
const DEFAULT_LM_STUDIO_MODEL = 'qwen3';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OPENROUTER_MODEL = 'z-ai/glm-4.7-flash';

const DEFAULT_TIER_CONFIG: LLMTierConfig = {
  provider: 'openai',
  openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
  openaiApiKey: '',
  openaiModel: DEFAULT_OPENAI_MODEL,
  googleApiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
};

const defaults: AppSettings = {
  backendMode: 'local',
  llmBackend: 'local',
  comfyBackend: 'local',
  comfyuiMode: 'inherit',
  comfyuiUrl: '',
  comfyCloudApiKey: '',
  comfyuiTimeout: FIXED_COMFYUI_TIMEOUT_SECONDS,
  llmProvider: 'lmstudio',
  lmStudioUrl: DEFAULT_LM_STUDIO_URL,
  lmStudioModel: DEFAULT_LM_STUDIO_MODEL,
  googleApiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  openaiApiKey: '',
  openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
  openaiModel: DEFAULT_OPENAI_MODEL,
  openRouterApiKey: '',
  openRouterModel: DEFAULT_OPENROUTER_MODEL,
  themeId: DEFAULT_THEME_ID,
  piOversight: true,
  vlmJudge: true,
  vlmProvider: 'openai',
  vlmBaseUrl: '',
  vlmApiKey: '',
  vlmModel: '',
  llmUseSameForAllTiers: true,
  llmTierMedium: { ...DEFAULT_TIER_CONFIG },
  llmTierLight: { ...DEFAULT_TIER_CONFIG },
};

const store = new Store<AppSettings>({
  name: 'kshana-settings',
  defaults,
  clearInvalidConfig: true,
});

function normalizeComfyUIMode(value: unknown): ComfyUIMode | null {
  if (value === 'inherit' || value === 'custom') {
    return value;
  }
  return null;
}

function normalizeBackendMode(value: unknown): BackendMode {
  return value === 'cloud' ? 'cloud' : 'local';
}

function normalizeBackendLane(value: unknown): BackendLane | null {
  if (value === 'cloud' || value === 'local') return value;
  return null;
}

function normalizeComfyUIUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeThemeId(value: unknown): ThemeId {
  if (
    value === 'studio-neutral' ||
    value === 'deep-forest-gold' ||
    value === 'petroleum-clay' ||
    value === 'paper-light' ||
    value === 'void-cut'
  ) {
    return value;
  }
  return DEFAULT_THEME_ID;
}

function normalizeLLMProvider(value: unknown): LLMProvider {
  switch (value) {
    case 'gemini':
    case 'openai':
    case 'openrouter':
    case 'lmstudio':
      return value;
    default:
      return 'lmstudio';
  }
}

function normalizeTierConfig(value: unknown): LLMTierConfig {
  const v = (value as Partial<LLMTierConfig> | null | undefined) ?? {};
  const provider: LLMTierConfig['provider'] =
    v.provider === 'gemini' ? 'gemini' : 'openai';
  return {
    provider,
    openaiBaseUrl: normalizeString(v.openaiBaseUrl, DEFAULT_OPENAI_BASE_URL),
    openaiApiKey: normalizeString(v.openaiApiKey),
    openaiModel: normalizeString(v.openaiModel, DEFAULT_OPENAI_MODEL),
    googleApiKey: normalizeString(v.googleApiKey),
    geminiModel: normalizeString(v.geminiModel, DEFAULT_GEMINI_MODEL),
  };
}

function normalizeString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function normalizeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const comfyuiUrl = normalizeComfyUIUrl(value?.comfyuiUrl);
  // Backend lanes: prefer the new explicit fields. If they're absent
  // (older persisted settings), migrate from the legacy single
  // `backendMode` toggle — that switch used to gate both lanes
  // together, so copy its value to both. New installs default to
  // 'local' on both.
  const persistedLlmBackend = normalizeBackendLane(value?.llmBackend);
  const persistedComfyBackend = normalizeBackendLane(value?.comfyBackend);
  const legacyBackendMode = normalizeBackendMode(value?.backendMode);
  const llmBackend: BackendLane = persistedLlmBackend ?? legacyBackendMode;
  const comfyBackend: BackendLane = persistedComfyBackend ?? legacyBackendMode;
  // Coarse "is at least one lane on cloud" — derived, kept for
  // back-compat with sign-in / landing-screen paths that still gate
  // on `backendMode`.
  const backendMode: BackendMode =
    llmBackend === 'cloud' || comfyBackend === 'cloud' ? 'cloud' : 'local';
  const comfyCloudApiKey = normalizeString(value?.comfyCloudApiKey);
  const explicitMode = normalizeComfyUIMode(value?.comfyuiMode);
  const themeId = normalizeThemeId(value?.themeId);
  const llmProvider = normalizeLLMProvider(value?.llmProvider);
  const lmStudioUrl = normalizeString(value?.lmStudioUrl, DEFAULT_LM_STUDIO_URL);
  const lmStudioModel = normalizeString(
    value?.lmStudioModel,
    DEFAULT_LM_STUDIO_MODEL,
  );
  const googleApiKey = normalizeString(value?.googleApiKey);
  const geminiModel = normalizeString(value?.geminiModel, DEFAULT_GEMINI_MODEL);
  const openaiApiKey = normalizeString(value?.openaiApiKey);
  const openaiBaseUrl = normalizeString(
    value?.openaiBaseUrl,
    DEFAULT_OPENAI_BASE_URL,
  );
  const openaiModel = normalizeString(value?.openaiModel, DEFAULT_OPENAI_MODEL);
  const openRouterApiKey = normalizeString(value?.openRouterApiKey);
  const openRouterModel = normalizeString(
    value?.openRouterModel,
    DEFAULT_OPENROUTER_MODEL,
  );
  const projectDir = typeof value?.projectDir === 'string' && value.projectDir.trim().length > 0
    ? value.projectDir
    : undefined;
  // Booleans default to TRUE when absent — matches the "default ON
  // for new projects" rule. `=== false` distinguishes
  // explicitly-off from missing.
  const piOversight = (value as { piOversight?: unknown } | null | undefined)?.piOversight === false ? false : true;
  const vlmJudge = (value as { vlmJudge?: unknown } | null | undefined)?.vlmJudge === false ? false : true;
  const rawVlmProvider = (value as { vlmProvider?: unknown } | null | undefined)?.vlmProvider;
  const vlmProvider: 'openai' | 'gemini' =
    rawVlmProvider === 'gemini' ? 'gemini' : 'openai';
  const vlmBaseUrl = normalizeString(value?.vlmBaseUrl);
  const vlmApiKey = normalizeString(value?.vlmApiKey);
  const vlmModel = normalizeString(value?.vlmModel);
  // Tier defaults to true ("use same LLM for everything") so existing
  // installs with a single Settings entry keep their pre-tier behavior.
  const llmUseSameForAllTiers =
    (value as { llmUseSameForAllTiers?: unknown } | null | undefined)?.llmUseSameForAllTiers === false
      ? false
      : true;
  const llmTierMedium = normalizeTierConfig(value?.llmTierMedium);
  const llmTierLight = normalizeTierConfig(value?.llmTierLight);

  // Backward compatibility:
  // - Missing mode + empty URL => inherit
  // - Missing mode + legacy localhost default => inherit
  // - Missing mode + non-empty URL => custom
  const derivedMode: ComfyUIMode = explicitMode ?? (
    !comfyuiUrl || comfyuiUrl === LEGACY_LOCAL_COMFYUI_URL ? 'inherit' : 'custom'
  );

  const normalizedMode: ComfyUIMode = derivedMode === 'custom' && !comfyuiUrl
    ? 'inherit'
    : derivedMode;

  const normalized: AppSettings = {
    backendMode,
    llmBackend,
    comfyBackend,
    comfyuiMode: normalizedMode,
    comfyuiUrl: normalizedMode === 'custom' ? comfyuiUrl : '',
    comfyCloudApiKey,
    comfyuiTimeout: FIXED_COMFYUI_TIMEOUT_SECONDS,
    llmProvider,
    lmStudioUrl,
    lmStudioModel,
    googleApiKey,
    geminiModel,
    openaiApiKey,
    openaiBaseUrl,
    openaiModel,
    openRouterApiKey,
    openRouterModel,
    themeId,
    piOversight,
    vlmJudge,
    vlmProvider,
    vlmBaseUrl,
    vlmApiKey,
    vlmModel,
    llmUseSameForAllTiers,
    llmTierMedium,
    llmTierLight,
  };

  if (projectDir) {
    normalized.projectDir = projectDir;
  }

  return normalized;
}

export const getSettings = (): AppSettings => {
  const normalized = normalizeSettings(store.store as Partial<AppSettings>);
  store.set(normalized);
  return normalized;
};

export const updateSettings = (patch: Partial<AppSettings>): AppSettings => {
  const current = store.store as Partial<AppSettings>;
  const merged = {
    ...current,
    ...patch,
  };
  const normalized = normalizeSettings(merged);
  store.set(normalized);
  return normalized;
};

export {
  normalizeSettings,
  normalizeThemeId,
  normalizeLLMProvider,
  normalizeBackendMode,
  DEFAULT_THEME_ID,
};

/**
 * Legacy fallback for backend URL migration.
 * We no longer expose serverUrl in settings UI, but existing installs may
 * still have it persisted in electron-store.
 */
export const getStoredServerUrl = (): string | undefined => {
  const value = store.get('serverUrl');
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export type { AppSettings } from '../shared/settingsTypes';
