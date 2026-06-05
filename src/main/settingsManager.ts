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
import {
  encryptCredential,
  decryptCredential,
  TOP_LEVEL_CREDENTIAL_FIELDS,
  TIER_CREDENTIAL_FIELDS,
} from './credentialCipher';

const FIXED_COMFYUI_TIMEOUT_SECONDS = 1800;
const LEGACY_LOCAL_COMFYUI_URL = 'http://localhost:8000';
const DEFAULT_THEME_ID: ThemeId = 'cinematic';
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
  vlmBackend: 'local',
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
  comfyEndpoints: {
    // public.cloud has a sensible community default. User-specific
    // endpoints (self.local, self.cloud) are empty until the user
    // configures them in Settings → ComfyUI Endpoints.
    'public.cloud': 'https://cloud.comfy.org/api',
  },
  llmUseSameForAllTiers: true,
  llmTierMedium: { ...DEFAULT_TIER_CONFIG },
  llmTierLight: { ...DEFAULT_TIER_CONFIG },
};

const store = new Store<AppSettings>({
  name: 'dhee-settings',
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
    value === 'cinematic' ||
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
  const persistedVlmBackend = normalizeBackendLane(value?.vlmBackend);
  const legacyBackendMode = normalizeBackendMode(value?.backendMode);
  const llmBackend: BackendLane = persistedLlmBackend ?? legacyBackendMode;
  const comfyBackend: BackendLane = persistedComfyBackend ?? legacyBackendMode;
  // For VLM, the legacy behavior was "follow llmBackend". Migrate to
  // the same value as the resolved llmBackend so existing installs
  // keep their pre-split UX, but going forward the user can flip it
  // independently.
  const vlmBackend: BackendLane = persistedVlmBackend ?? llmBackend;
  // Coarse "is at least one lane on cloud" — derived, kept for
  // back-compat with sign-in / landing-screen paths that still gate
  // on `backendMode`.
  const backendMode: BackendMode =
    llmBackend === 'cloud' || comfyBackend === 'cloud' || vlmBackend === 'cloud'
      ? 'cloud'
      : 'local';
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

  // Named ComfyUI endpoints — each key is a semantic name a bundle can
  // reference (e.g. "self.local", "public.cloud"). Values must be
  // non-empty trimmed strings; anything else is dropped. The defaults
  // block seeds public.cloud; merge user-provided keys over it so a
  // setting-file edit can override or extend without losing the
  // default.
  const rawEndpoints = (value as { comfyEndpoints?: unknown } | null | undefined)?.comfyEndpoints;
  const comfyEndpoints: Record<string, string> = { 'public.cloud': 'https://cloud.comfy.org/api' };
  if (rawEndpoints && typeof rawEndpoints === 'object' && !Array.isArray(rawEndpoints)) {
    for (const [name, url] of Object.entries(rawEndpoints as Record<string, unknown>)) {
      if (typeof url === 'string' && url.trim().length > 0) {
        comfyEndpoints[name] = url.trim();
      }
    }
  }

  const normalized: AppSettings = {
    backendMode,
    llmBackend,
    comfyBackend,
    vlmBackend,
    comfyuiMode: normalizedMode,
    comfyuiUrl: normalizedMode === 'custom' ? comfyuiUrl : '',
    comfyCloudApiKey,
    comfyEndpoints,
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

/**
 * Decrypt credential fields in-place on a settings object. Used after
 * loading from disk so the rest of the app sees plaintext keys.
 */
function decryptCredentialFields(s: AppSettings): AppSettings {
  for (const field of TOP_LEVEL_CREDENTIAL_FIELDS) {
    const raw = (s as unknown as Record<string, unknown>)[field];
    if (typeof raw === 'string') {
      (s as unknown as Record<string, string>)[field] = decryptCredential(raw);
    }
  }
  for (const tierKey of ['llmTierMedium', 'llmTierLight'] as const) {
    const tier = s[tierKey];
    if (tier && typeof tier === 'object') {
      for (const field of TIER_CREDENTIAL_FIELDS) {
        const raw = (tier as unknown as Record<string, unknown>)[field];
        if (typeof raw === 'string') {
          (tier as unknown as Record<string, string>)[field] = decryptCredential(raw);
        }
      }
    }
  }
  return s;
}

/**
 * Encrypt credential fields before persisting. The on-disk copy ends
 * up with `__kshana_enc_v1__<base64>` envelopes for every API key;
 * URLs / model names / etc. stay plaintext for debuggability.
 */
function encryptCredentialFields(s: AppSettings): AppSettings {
  const cloned: AppSettings = {
    ...s,
    llmTierMedium: { ...s.llmTierMedium },
    llmTierLight: { ...s.llmTierLight },
  };
  for (const field of TOP_LEVEL_CREDENTIAL_FIELDS) {
    const v = (cloned as unknown as Record<string, unknown>)[field];
    if (typeof v === 'string') {
      (cloned as unknown as Record<string, string>)[field] = encryptCredential(v);
    }
  }
  for (const tierKey of ['llmTierMedium', 'llmTierLight'] as const) {
    const tier = cloned[tierKey];
    if (tier) {
      for (const field of TIER_CREDENTIAL_FIELDS) {
        const v = (tier as unknown as Record<string, unknown>)[field];
        if (typeof v === 'string') {
          (tier as unknown as Record<string, string>)[field] = encryptCredential(v);
        }
      }
    }
  }
  return cloned;
}

export const getSettings = (): AppSettings => {
  // Read the on-disk envelope, normalize the schema (which may rewrite
  // legacy fields), then decrypt the credentials for in-memory use.
  const normalized = normalizeSettings(store.store as Partial<AppSettings>);
  // Persist the encrypted-on-disk form. If any credential was loaded
  // as legacy plaintext, encryptCredentialFields turns it into the
  // enveloped form here — silent one-shot migration on first read
  // after upgrade.
  store.set(encryptCredentialFields(normalized));
  return decryptCredentialFields(normalized);
};

export const updateSettings = (patch: Partial<AppSettings>): AppSettings => {
  // Decrypt the current on-disk state before merging the patch so we
  // don't accidentally mix enveloped values with the caller's plaintext
  // update. Then re-encrypt the merged result for storage and return
  // plaintext to the caller.
  const stored = normalizeSettings(store.store as Partial<AppSettings>);
  const currentDecrypted = decryptCredentialFields(stored);
  const merged = {
    ...currentDecrypted,
    ...patch,
  };
  const normalized = normalizeSettings(merged);
  store.set(encryptCredentialFields(normalized));
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
