import { useEffect, useState } from 'react';
import type {
  AccountInfo,
  AppSettings,
  LLMProvider,
  LLMTierConfig,
  ThemeId,
} from '../../../shared/settingsTypes';
import type {
  LlmModelInfo,
  ProviderDiagnosticItem,
  ProviderDiagnosticsSnapshot,
  ProviderDiagnosticStatus,
} from '../../../shared/providerDiagnosticsTypes';
import { useFirstRunSetup } from '../../contexts/FirstRunSetupContext';
import { ComboList } from '../ui';
import AccountTab from './AccountTab';
import WorkflowsTab from './WorkflowsTab';
import styles from './SettingsPanel.module.scss';

type SettingsTab =
  | 'account'
  | 'connection'
  | 'workflows'
  | 'diagnostics';

interface LogsBridge {
  getDir(): Promise<string>;
  reveal(): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  exportZip(): Promise<
    | { ok: true; path: string; bytes: number; fileCount: number }
    | { ok: false; error: string }
  >;
}

function getLogsBridge(): LogsBridge | undefined {
  return (window.electron as typeof window.electron & { logs?: LogsBridge })
    .logs;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

type Props = {
  isOpen: boolean;
  variant?: 'modal' | 'embedded';
  initialTab?: SettingsTab;
  settings: AppSettings | null;
  onClose: () => void;
  onThemeChange: (themeId: ThemeId) => Promise<void> | void;
  onSaveConnection: (settings: Partial<AppSettings>) => Promise<boolean> | void;
  isSavingConnection: boolean;
  error?: string | null;
};

type ModelListState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  models: string[];
  modelDetails?: LlmModelInfo[];
  message?: string;
};

type ModelWarmState = {
  status: 'loading' | 'ready' | 'error';
  message: string;
};

const emptyTierConfig: LLMTierConfig = {
  provider: 'openai',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
};

const emptySettings: AppSettings = {
  backendMode: 'local',
  llmBackend: 'local',
  comfyBackend: 'local',
  vlmBackend: 'local',
  comfyuiMode: 'inherit',
  comfyuiUrl: '',
  singleGpuMode: false,
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'openai',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
  themeId: 'cinematic',
  piOversight: true,
  vlmJudge: true,
  vlmProvider: 'openai',
  vlmBaseUrl: '',
  vlmApiKey: '',
  vlmModel: '',
  llmUseSameForAllTiers: true,
  llmTierMedium: { ...emptyTierConfig },
  llmTierLight: { ...emptyTierConfig },
  budgetCapUsd: 5,
};

function normalizeConnectionSettings(input: AppSettings | null): AppSettings {
  const next = input ?? emptySettings;
  const comfyuiUrl = (next.comfyuiUrl || '').trim();
  const backendMode = next.backendMode === 'cloud' ? 'cloud' : 'local';

  return {
    ...emptySettings,
    ...next,
    backendMode,
    llmProvider: next.llmProvider === 'gemini' ? 'gemini' : 'openai',
    comfyuiMode: comfyuiUrl ? 'custom' : 'inherit',
    comfyuiUrl,
    singleGpuMode: next.singleGpuMode === true,
    budgetCapUsd:
      typeof next.budgetCapUsd === 'number' &&
      Number.isFinite(next.budgetCapUsd) &&
      next.budgetCapUsd >= 0
        ? next.budgetCapUsd
        : emptySettings.budgetCapUsd,
    comfyCloudApiKey: next.comfyCloudApiKey ?? '',
    googleApiKey: next.googleApiKey ?? '',
    geminiModel: next.geminiModel?.trim() || emptySettings.geminiModel,
    openaiApiKey: next.openaiApiKey ?? '',
    openaiBaseUrl: next.openaiBaseUrl?.trim() || emptySettings.openaiBaseUrl,
    openaiModel: next.openaiModel?.trim() || emptySettings.openaiModel,
  };
}

function deriveBackendMode(
  settings: Pick<AppSettings, 'llmBackend' | 'comfyBackend' | 'vlmBackend'>,
) {
  return settings.llmBackend === 'cloud' ||
    settings.comfyBackend === 'cloud' ||
    settings.vlmBackend === 'cloud'
    ? 'cloud'
    : 'local';
}

function canAccountUseHostedComfy(account: AccountInfo | null): boolean {
  return (
    account?.subscriptionStatus === 'active' &&
    (
      account.planId === 'standard_20' ||
      account.planId === 'creator_35' ||
      account.planId === 'pro_100'
    )
  );
}

function getAccountBridge() {
  return (window.electron as typeof window.electron & {
    account?: typeof window.electron.account;
  }).account;
}

function getProviderDiagnosticsBridge() {
  return (window.electron as typeof window.electron & {
    providerDiagnostics?: typeof window.electron.providerDiagnostics;
  }).providerDiagnostics;
}

function diagnosticBadgeClass(status: ProviderDiagnosticStatus): string {
  switch (status) {
    case 'ready':
      return styles.statusBadgeSuccess;
    case 'error':
      return styles.statusBadgeError;
    case 'warning':
      return styles.statusBadgeWarning;
    case 'unknown':
    default:
      return styles.statusBadgeNeutral;
  }
}

export default function SettingsPanel({
  isOpen,
  variant = 'modal',
  initialTab = 'connection',
  settings,
  onClose,
  onSaveConnection,
  isSavingConnection,
  error,
}: Props) {
  const isEmbedded = variant === 'embedded';
  const isVisible = isEmbedded || isOpen;
  const [form, setForm] = useState<AppSettings>(
    normalizeConnectionSettings(settings),
  );
  const [activeTab, setActiveTab] = useState<SettingsTab>('connection');
  const { open: openGuidedSetup } = useFirstRunSetup();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [logsDir, setLogsDir] = useState<string | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<
    'reveal' | 'export' | null
  >(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [providerDiagnostics, setProviderDiagnostics] =
    useState<ProviderDiagnosticsSnapshot | null>(null);
  const [providerDiagnosticsBusy, setProviderDiagnosticsBusy] = useState(false);
  const [modelLists, setModelLists] = useState<Record<string, ModelListState>>({});
  const [modelWarmStates, setModelWarmStates] = useState<Record<string, ModelWarmState>>({});
  const canUseHostedComfy = canAccountUseHostedComfy(account);
  const isComfyBlockedByPlan = Boolean(account) && !canUseHostedComfy;

  useEffect(() => {
    if (activeTab !== 'diagnostics') return;
    const bridge = getLogsBridge();
    if (!bridge) return;
    bridge
      .getDir()
      .then(setLogsDir)
      .catch(() => setLogsDir(null));
  }, [activeTab]);

  const handleRevealLogs = async () => {
    const bridge = getLogsBridge();
    if (!bridge) return;
    setDiagnosticsBusy('reveal');
    setDiagnosticsMessage(null);
    try {
      const result = await bridge.reveal();
      if (result.ok) {
        setDiagnosticsMessage({
          kind: 'success',
          text: `Opened ${result.path}`,
        });
      } else {
        setDiagnosticsMessage({ kind: 'error', text: result.error });
      }
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const handleExportLogs = async () => {
    const bridge = getLogsBridge();
    if (!bridge) return;
    setDiagnosticsBusy('export');
    setDiagnosticsMessage(null);
    try {
      const result = await bridge.exportZip();
      if (result.ok) {
        setDiagnosticsMessage({
          kind: 'success',
          text: `Saved ${result.fileCount} log files (${formatBytes(result.bytes)}) to ${result.path}`,
        });
      } else {
        setDiagnosticsMessage({ kind: 'error', text: result.error });
      }
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const handleProviderDiagnostics = async () => {
    const bridge = getProviderDiagnosticsBridge();
    if (!bridge) return;
    setProviderDiagnosticsBusy(true);
    try {
      setProviderDiagnostics(await bridge.run());
    } catch {
      setProviderDiagnostics({
        checkedAt: Date.now(),
        items: [
          {
            id: 'llm',
            label: 'Provider checks',
            status: 'error',
            message: 'Provider checks are unavailable in this build.',
          },
        ],
      });
    } finally {
      setProviderDiagnosticsBusy(false);
    }
  };

  const loadModels = async (
    key: string,
    input: {
      provider: 'openai' | 'gemini';
      apiKey?: string;
      model?: string;
      baseUrl?: string;
    },
  ) => {
    setModelLists((prev) => ({
      ...prev,
      [key]: {
        status: 'loading',
        models: prev[key]?.models ?? [],
        modelDetails: prev[key]?.modelDetails,
      },
    }));
    try {
      const bridge = getProviderDiagnosticsBridge();
      if (!bridge?.probeLlm) {
        throw new Error('Model lookup is unavailable in this build.');
      }
      const result = await bridge.probeLlm(input);
      if (result.ok) {
        setModelLists((prev) => ({
          ...prev,
          [key]: {
            status: 'ready',
            models: result.models ?? [],
            modelDetails: result.modelDetails,
            message: result.message,
          },
        }));
      } else {
        setModelLists((prev) => ({
          ...prev,
          [key]: {
            status: 'error',
            models: [],
            message: result.detail ?? result.message,
          },
        }));
      }
    } catch (err) {
      setModelLists((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          models: [],
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const warmSelectedModel = async (
    key: string,
    input: {
      provider: 'openai' | 'gemini';
      apiKey?: string;
      model?: string;
      baseUrl?: string;
    },
  ) => {
    if (!input.model) return;
    setModelWarmStates((prev) => ({
      ...prev,
      [key]: { status: 'loading', message: `Loading ${input.model}...` },
    }));
    try {
      const bridge = getProviderDiagnosticsBridge();
      if (!bridge?.warmLlmModel) {
        throw new Error('Model loading is unavailable in this build.');
      }
      const result = await bridge.warmLlmModel(input);
      setModelWarmStates((prev) => ({
        ...prev,
        [key]: {
          status: result.ok ? 'ready' : 'error',
          message: result.ok ? result.message : result.detail ?? result.message,
        },
      }));
      await loadModels(key, input);
    } catch (err) {
      setModelWarmStates((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };
  useEffect(() => {
    setForm(normalizeConnectionSettings(settings));
  }, [settings, isVisible]);

  useEffect(() => {
    if (isVisible) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isVisible]);

  useEffect(() => {
    if (!isOpen || isEmbedded) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSavingConnection) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSavingConnection, onClose, isEmbedded]);

  useEffect(() => {
    if (!isVisible) return undefined;
    const accountBridge = getAccountBridge();
    if (!accountBridge) return undefined;

    accountBridge.get().then(setAccount).catch(() => setAccount(null));
    return accountBridge.onChange((nextAccount) => {
      setAccount(nextAccount);
      if (nextAccount) {
        setSignInError(null);
      }
    });
  }, [isVisible]);

  useEffect(() => {
    if (!isComfyBlockedByPlan) return;
    setForm((prev) => {
      if (prev.comfyBackend !== 'cloud') return prev;
      const next = { ...prev, comfyBackend: 'local' as const };
      return { ...next, backendMode: deriveBackendMode(next) };
    });
  }, [isComfyBlockedByPlan]);

  const handleInlineSignIn = async () => {
    const accountBridge = getAccountBridge();
    if (!accountBridge) {
      setSignInError('Sign-in is unavailable in this build.');
      return;
    }
    setSignInError(null);
    setSigningIn(true);
    try {
      await accountBridge.signIn();
    } catch (err) {
      setSignInError(
        err instanceof Error ? err.message : 'Sign-in failed. Please try again.',
      );
    } finally {
      setSigningIn(false);
    }
  };

  if (!isVisible) {
    return null;
  }

  const handleInput = (
    key: keyof AppSettings,
    value: string | number | boolean | undefined,
  ) => {
    // Defense-in-depth: the cloud-lane checkboxes are `disabled` when
    // !account so this branch is normally unreachable from the UI, but
    // a stray IPC / programmatic update should still be rejected.
    const isLaneToggle =
      key === 'llmBackend' || key === 'comfyBackend' || key === 'vlmBackend';
    if (isLaneToggle && value === 'cloud' && !account) {
      return;
    }
    if (key === 'comfyBackend' && value === 'cloud' && !canUseHostedComfy) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const saveConnectionSettings = async (nextForm: AppSettings) => {
    const normalized = normalizeConnectionSettings(nextForm);
    const comfyBackend = canUseHostedComfy ? normalized.comfyBackend : 'local';
    const backendMode = deriveBackendMode({ ...normalized, comfyBackend });
    await onSaveConnection({
      backendMode,
      llmBackend: normalized.llmBackend,
      comfyBackend,
      vlmBackend: normalized.vlmBackend,
      comfyuiMode: normalized.comfyuiUrl ? 'custom' : 'inherit',
      comfyuiUrl: normalized.comfyuiUrl,
      singleGpuMode: normalized.singleGpuMode,
      budgetCapUsd: normalized.budgetCapUsd,
      comfyCloudApiKey: normalized.comfyCloudApiKey,
      llmProvider: normalized.llmProvider,
      googleApiKey: normalized.googleApiKey,
      geminiModel: normalized.geminiModel,
      openaiApiKey: normalized.openaiApiKey,
      openaiBaseUrl: normalized.openaiBaseUrl,
      openaiModel: normalized.openaiModel,
      llmUseSameForAllTiers: normalized.llmUseSameForAllTiers,
      llmTierMedium: normalized.llmTierMedium,
      llmTierLight: normalized.llmTierLight,
      vlmProvider: normalized.vlmProvider,
      vlmBaseUrl: normalized.vlmBaseUrl,
      vlmApiKey: normalized.vlmApiKey,
      vlmModel: normalized.vlmModel,
    });
  };

  const handleTierInput = (
    tier: 'llmTierMedium' | 'llmTierLight',
    field: keyof LLMTierConfig,
    value: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], [field]: value },
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await saveConnectionSettings(form);
  };

  const handleOverlayClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  // `isCloudMode` = "is at least one lane on cloud" — used for the
  // overall status badge / sign-in CTA.
  const isCloudMode = form.backendMode === 'cloud';
  const isCloudReady = isCloudMode && Boolean(account);
  // Per-lane disable flags. ComfyUI inputs (URL, key) are inert when
  // comfyBackend='cloud'; LLM provider/url/model/key inputs are inert
  // when llmBackend='cloud'. The two are independent — flipping one
  // doesn't affect the other.
  const isComfyCloudMode =
    form.comfyBackend === 'cloud' && !isComfyBlockedByPlan;
  const isLlmCloudMode = form.llmBackend === 'cloud';
  const isVlmCloudMode = form.vlmBackend === 'cloud';
  // VLM judge master switch (moved here from the retired Appearance tab).
  // Reads persisted settings and saves immediately on toggle — its own
  // value, independent of the connection form's Save & Restart.
  const isVlmJudgeOn = settings?.vlmJudge ?? emptySettings.vlmJudge;
  let comfyCloudToggleTitle: string | undefined;
  if (!account) {
    comfyCloudToggleTitle = 'Sign in to Dhee Cloud to enable Cloud mode';
  } else if (isComfyBlockedByPlan) {
    comfyCloudToggleTitle =
      'Your current plan uses bring-your-own ComfyUI for image and video';
  }
  let comfyInfoText = 'Image / video jobs run on the ComfyUI server below.';
  if (isComfyBlockedByPlan) {
    comfyInfoText =
      'Starter and Free accounts bring their own ComfyUI endpoint for image and video. Configure your ComfyUI server below.';
  } else if (isComfyCloudMode) {
    comfyInfoText = 'Image / video jobs run on Dhee Cloud (uses credits).';
  }
  const statusLabel = isCloudReady || !isCloudMode ? 'Ready' : 'Sign in';
  const statusBadgeClass = isCloudReady || !isCloudMode
    ? styles.statusBadgeSuccess
    : styles.statusBadgeWarning;
  const statusHeadline = isCloudMode
    ? isCloudReady
      ? 'Connected to Cloud'
      : 'Cloud sign-in required'
    : 'Connected to Local';

  const renderModelIdInput = (opts: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    provider: 'openai' | 'gemini';
    apiKey?: string;
    baseUrl?: string;
    disabled?: boolean;
    placeholder: string;
    tourId?: string;
  }) => {
    const state = modelLists[opts.id] ?? { status: 'idle' as const, models: [] };
    const warmState = modelWarmStates[opts.id];
    const canQuery =
      !opts.disabled &&
      (opts.provider === 'openai' || Boolean((opts.apiKey ?? '').trim()));
    const query = async () => {
      if (!canQuery) return;
      await loadModels(opts.id, {
        provider: opts.provider,
        apiKey: opts.apiKey,
        model: opts.value,
        ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      });
    };

    return (
      <div className={styles.label}>
        <div className={styles.labelRow}>
          <span>{opts.label}</span>
          <button
            type="button"
            className={styles.inlineButton}
            onClick={() => {
              void query();
            }}
            disabled={!canQuery || state.status === 'loading'}
          >
            {state.status === 'loading' ? 'Loading models...' : 'Refresh models'}
          </button>
        </div>
        <ComboList
          value={opts.value}
          onChange={(value) => {
            opts.onChange(value);
            setModelWarmStates((prev) => {
              const next = { ...prev };
              delete next[opts.id];
              return next;
            });
          }}
          onOptionSelect={(value) => {
            opts.onChange(value);
            if (opts.provider === 'openai') {
              void warmSelectedModel(opts.id, {
                provider: opts.provider,
                apiKey: opts.apiKey,
                model: value,
                ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
              });
            }
          }}
          options={state.models.map((model) => {
            const detail = state.modelDetails?.find((m) => m.id === model);
            return {
              value: model,
              label: detail?.status ? `${model}  ·  ${detail.status}` : model,
            };
          })}
          loading={state.status === 'loading'}
          disabled={opts.disabled}
          triggerDisabled={!canQuery}
          placeholder={opts.placeholder}
          buttonLabel="Models"
          inputClassName={`${styles.input} ${styles.modelComboInput}`}
          dataTourId={opts.tourId}
          onRequestOptions={query}
        />
        {state.status === 'ready' && state.models.length > 0 ? (
          <p className={styles.modelListHint}>
            {state.models.length} model{state.models.length === 1 ? '' : 's'} available from endpoint. You can still type a custom id.
          </p>
        ) : null}
        {warmState ? (
          <p
            className={
              warmState.status === 'error'
                ? styles.modelListError
                : styles.modelListHint
            }
          >
            {warmState.message}
          </p>
        ) : null}
        {state.status === 'ready' && state.models.length === 0 ? (
          <p className={styles.modelListHint}>
            Endpoint reached, but it did not return model ids. Type one manually.
          </p>
        ) : null}
        {state.status === 'error' ? (
          <p className={styles.modelListError}>
            {state.message ?? 'Could not load models. Type one manually.'}
          </p>
        ) : null}
      </div>
    );
  };

  const renderTierSection = (
    tier: 'llmTierMedium' | 'llmTierLight',
    label: string,
    description: string,
  ) => {
    const cfg = form[tier];
    return (
      <fieldset className={styles.fieldset} disabled={isLlmCloudMode}>
        <legend>{label}</legend>
        <p className={styles.infoText}>{description}</p>
        <div className={styles.radios}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              className={styles.radioInput}
              name={`${tier}-provider`}
              value="gemini"
              checked={cfg.provider === 'gemini'}
              disabled={isLlmCloudMode}
              onChange={() => handleTierInput(tier, 'provider', 'gemini')}
            />
            Gemini
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              className={styles.radioInput}
              name={`${tier}-provider`}
              value="openai"
              checked={cfg.provider === 'openai'}
              disabled={isLlmCloudMode}
              onChange={() => handleTierInput(tier, 'provider', 'openai')}
            />
            OpenAI-Compatible
          </label>
        </div>

        {cfg.provider === 'gemini' && (
          <>
            {renderModelIdInput({
              id: `${tier}-gemini-model`,
              label: 'Gemini Model ID',
              value: cfg.geminiModel,
              provider: 'gemini',
              apiKey: cfg.googleApiKey,
              disabled: isLlmCloudMode,
              placeholder: 'gemini-2.5-flash',
              onChange: (value) => handleTierInput(tier, 'geminiModel', value),
            })}
            <label className={styles.label}>
              Google API Key
              <input
                type="password"
                className={styles.input}
                value={cfg.googleApiKey}
                disabled={isLlmCloudMode}
                onChange={(event) =>
                  handleTierInput(tier, 'googleApiKey', event.target.value)
                }
                placeholder="AIza..."
              />
            </label>
          </>
        )}

        {cfg.provider === 'openai' && (
          <>
            <label className={styles.label}>
              Base URL
              <input
                type="url"
                className={styles.input}
                value={cfg.openaiBaseUrl}
                disabled={isLlmCloudMode}
                onChange={(event) =>
                  handleTierInput(tier, 'openaiBaseUrl', event.target.value)
                }
                placeholder="https://api.openai.com/v1"
              />
            </label>
            {renderModelIdInput({
              id: `${tier}-openai-model`,
              label: 'Model ID',
              value: cfg.openaiModel,
              provider: 'openai',
              apiKey: cfg.openaiApiKey,
              baseUrl: cfg.openaiBaseUrl,
              disabled: isLlmCloudMode,
              placeholder: 'gpt-4o',
              onChange: (value) => handleTierInput(tier, 'openaiModel', value),
            })}
            <label className={styles.label}>
              API Key
              <input
                type="password"
                className={styles.input}
                value={cfg.openaiApiKey}
                disabled={isLlmCloudMode}
                onChange={(event) =>
                  handleTierInput(tier, 'openaiApiKey', event.target.value)
                }
                placeholder="sk-..."
              />
            </label>
          </>
        )}
      </fieldset>
    );
  };

  const renderProviderToggle = (provider: LLMProvider, label: string) => (
    <label className={styles.radioLabel}>
      <input
        type="radio"
        className={styles.radioInput}
        name="llm-provider"
        value={provider}
        checked={form.llmProvider === provider}
        disabled={isLlmCloudMode}
        onChange={(event) =>
          handleInput(
            'llmProvider',
            event.target.value as AppSettings['llmProvider'],
          )
        }
      />
      {label}
    </label>
  );

  const renderProviderDiagnostic = (item: ProviderDiagnosticItem) => (
    <div key={item.id} className={styles.providerDiagnosticRow}>
      <div>
        <div className={styles.providerDiagnosticTitle}>{item.label}</div>
        <p className={styles.providerDiagnosticMessage}>{item.message}</p>
        {item.detail ? (
          <p className={styles.providerDiagnosticDetail}>{item.detail}</p>
        ) : null}
      </div>
      <div
        className={`${styles.statusBadge} ${diagnosticBadgeClass(item.status)}`}
      >
        <span className={styles.statusDot} />
        {item.status}
      </div>
    </div>
  );

  const panelContent = (
    <div
      className={`${styles.panel} ${isEmbedded ? styles.embeddedPanel : ''}`}
    >
      <div className={styles.header}>
        <div>
          <h2>Settings</h2>
          <p>Adjust app preferences from one place.</p>
        </div>
        {isEmbedded ? (
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onClose}
          >
            Back to Projects
          </button>
        ) : (
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        )}
      </div>

      <div className={styles.content}>
        <aside className={styles.sidebar}>
          <button
            type="button"
            className={`${styles.tabButton} ${styles.tabLauncher}`}
            onClick={openGuidedSetup}
          >
            <span className={styles.tabLabel}>Guided setup →</span>
            <span className={styles.tabDescription}>Pick a recipe, connect, verify</span>
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'account' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('account')}
          >
            <span className={styles.tabLabel}>Account</span>
            <span className={styles.tabDescription}>Sign-in and credits</span>
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'connection' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('connection')}
          >
            <span className={styles.tabLabel}>Connection</span>
            <span className={styles.tabDescription}>
              Local providers or Dhee Cloud credits
            </span>
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'workflows' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('workflows')}
          >
            <span className={styles.tabLabel}>Workflows</span>
            <span className={styles.tabDescription}>
              Custom ComfyUI workflows
            </span>
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'diagnostics' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('diagnostics')}
          >
            <span className={styles.tabLabel}>Diagnostics</span>
            <span className={styles.tabDescription}>
              Logs &amp; troubleshooting
            </span>
          </button>
        </aside>

        <form className={styles.form} onSubmit={handleSubmit}>
          <section className={styles.section}>
            {activeTab === 'account' ? (
              <AccountTab />
            ) : activeTab === 'workflows' ? (
              <WorkflowsTab isCloudMode={settings?.comfyBackend === 'cloud'} />
            ) : activeTab === 'diagnostics' ? (
              <>
                <div className={styles.sectionHeader}>
                  <h3>Diagnostics</h3>
                  <p>
                    Share Dhee&apos;s logs with support to debug issues. The
                    logs include core runner output, ComfyUI debug
                    breadcrumbs, and the desktop session transcript — they
                    do not contain your project assets.
                  </p>
                </div>
                <div className={styles.statusCard}>
                  <div
                    className={styles.statusHeader}
                    style={{ marginBottom: 8 }}
                  >
                    Logs folder
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      opacity: 0.8,
                      wordBreak: 'break-all',
                      marginBottom: 16,
                    }}
                  >
                    {logsDir ?? 'Resolving…'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={styles.submitButton}
                      onClick={handleRevealLogs}
                      disabled={diagnosticsBusy !== null}
                    >
                      {diagnosticsBusy === 'reveal'
                        ? 'Opening…'
                        : 'Reveal logs folder'}
                    </button>
                    <button
                      type="button"
                      className={styles.submitButton}
                      onClick={handleExportLogs}
                      disabled={diagnosticsBusy !== null}
                    >
                      {diagnosticsBusy === 'export'
                        ? 'Bundling…'
                        : 'Export logs (.zip)'}
                    </button>
                  </div>
                  {diagnosticsMessage && (
                    <div
                      className={
                        diagnosticsMessage.kind === 'error'
                          ? styles.error
                          : undefined
                      }
                      style={{
                        marginTop: 12,
                        fontSize: 13,
                        wordBreak: 'break-all',
                      }}
                    >
                      {diagnosticsMessage.text}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className={styles.sectionHeader}>
                  <h3>Connection</h3>
                  <p>Choose BYO keys or Dhee Cloud credits for paid calls.</p>
                </div>

                <div className={styles.statusCard}>
                  <div className={styles.statusTopRow}>
                    <div>
                      <div className={styles.statusHeader}>Status</div>
                      <div className={styles.statusHeadline}>
                        {statusHeadline}
                      </div>
                    </div>
                    <div className={`${styles.statusBadge} ${statusBadgeClass}`}>
                      <span className={styles.statusDot} />
                      {statusLabel}
                    </div>
                  </div>
                  <div className={styles.providerDiagnosticsActions}>
                    <button
                      type="button"
                      className={styles.submitButton}
                      onClick={handleProviderDiagnostics}
                      disabled={providerDiagnosticsBusy}
                      data-tour-id="settings-provider-test"
                    >
                      {providerDiagnosticsBusy
                        ? 'Checking...'
                        : 'Test all providers'}
                    </button>
                  </div>
                  {providerDiagnostics ? (
                    <div
                      className={styles.providerDiagnosticsList}
                      aria-label="Provider readiness results"
                    >
                      {providerDiagnostics.items.map(renderProviderDiagnostic)}
                    </div>
                  ) : null}
                </div>

                <fieldset className={styles.fieldset}>
                  <legend>ComfyUI</legend>
                  <div
                    className={styles.cloudToggleRow}
                    data-tour-id="settings-cloud-toggles"
                  >
                    <label
                      className={styles.checkboxLabel}
                      title={comfyCloudToggleTitle}
                    >
                      <input
                        type="checkbox"
                        checked={isComfyCloudMode}
                        disabled={!canUseHostedComfy}
                        onChange={(event) =>
                          handleInput(
                            'comfyBackend',
                            event.target.checked ? 'cloud' : 'local',
                          )
                        }
                      />
                      Use Dhee Cloud for ComfyUI
                    </label>
                    {!account ? (
                      <button
                        type="button"
                        className={styles.inlineSignInButton}
                        onClick={handleInlineSignIn}
                        disabled={signingIn}
                        data-tour-id="settings-cloud-sign-in"
                      >
                        {signingIn ? 'Opening…' : 'Sign In'}
                      </button>
                    ) : null}
                  </div>
                  <p className={styles.infoText}>
                    {comfyInfoText}
                  </p>

                  {!isComfyCloudMode && (
                    <>
                      <label className={styles.label}>
                        ComfyUI URL
                        <input
                          type="url"
                          className={styles.input}
                          value={form.comfyuiUrl}
                          onChange={(event) =>
                            handleInput('comfyuiUrl', event.target.value)
                          }
                          placeholder="http://localhost:8000"
                          data-tour-id="settings-comfy-url"
                        />
                      </label>

                      <label className={styles.label}>
                        Comfy Cloud API Key
                        <input
                          type="password"
                          className={styles.input}
                          value={form.comfyCloudApiKey}
                          onChange={(event) =>
                            handleInput('comfyCloudApiKey', event.target.value)
                          }
                          placeholder="Only used for https://cloud.comfy.org"
                        />
                      </label>
                      <p className={styles.infoText}>
                        This key is only used when the ComfyUI URL points to
                        `https://cloud.comfy.org`. Local and self-hosted ComfyUI
                        connections ignore it.
                      </p>
                    </>
                  )}
                </fieldset>

                <fieldset className={styles.fieldset}>
                  <legend>Single GPU Mode</legend>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={form.singleGpuMode}
                      onChange={(event) =>
                        handleInput('singleGpuMode', event.target.checked)
                      }
                    />
                    Pause chat during local ComfyUI renders
                  </label>
                  <p className={styles.infoText}>
                    Use this when local ComfyUI and a local LLM share one GPU.
                    Chat stays available during LLM work and pauses only while
                    local ComfyUI is rendering.
                  </p>
                </fieldset>

                <fieldset className={styles.fieldset}>
                  <legend>Budget cap</legend>
                  <label className={styles.label}>
                    Stop a run after spending (USD)
                    <input
                      type="number"
                      className={styles.input}
                      min={0}
                      step={1}
                      value={form.budgetCapUsd}
                      onChange={(event) => {
                        const n = Number.parseFloat(event.target.value);
                        handleInput(
                          'budgetCapUsd',
                          Number.isFinite(n) && n >= 0 ? n : 0,
                        );
                      }}
                    />
                  </label>
                  <p className={styles.infoText}>
                    A safety limit on paid generation (cloud LLM / image / video).
                    A run pauses before the next paid step once a project reaches
                    this much spend, so a runaway loop can&apos;t burn through your
                    credits — you can then raise it and resume. Applies to new
                    projects. Set to <strong>0</strong> for no cap. Fully local
                    runs cost nothing and never hit it.
                  </p>
                </fieldset>

                <fieldset className={styles.fieldset}>
                  <legend>LLM</legend>
                  <div className={styles.cloudToggleRow}>
                    <label
                      className={styles.checkboxLabel}
                      title={
                        !account
                          ? 'Sign in to Dhee Cloud to enable Cloud mode'
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={isLlmCloudMode}
                        disabled={!account}
                        onChange={(event) =>
                          handleInput(
                            'llmBackend',
                            event.target.checked ? 'cloud' : 'local',
                          )
                        }
                      />
                      Use Dhee Cloud for LLM
                    </label>
                    {!account ? (
                      <button
                        type="button"
                        className={styles.inlineSignInButton}
                        onClick={handleInlineSignIn}
                        disabled={signingIn}
                      >
                        {signingIn ? 'Opening…' : 'Sign In'}
                      </button>
                    ) : null}
                  </div>
                  {signInError && !account ? (
                    <p className={styles.error}>{signInError}</p>
                  ) : null}
                  <p className={styles.infoText}>
                    {isLlmCloudMode
                      ? 'Chat / planning calls go through the Dhee Cloud proxy (uses credits).'
                      : 'Chat / planning calls go to the LLM provider configured below.'}
                  </p>

                  {!isLlmCloudMode && (
                    <>
                      <fieldset className={styles.fieldset}>
                        <legend>Heavy LLM (primary)</legend>
                        <p className={styles.infoText}>
                          Used for long-form creative work: story, scenes, shot
                          prompts, motion directives — and the pi-agent
                          orchestrator.
                        </p>
                        <div
                          className={styles.radios}
                          data-tour-id="settings-llm-provider"
                        >
                          {renderProviderToggle('gemini', 'Gemini')}
                          {renderProviderToggle('openai', 'OpenAI-Compatible')}
                        </div>
                      </fieldset>

                      {form.llmProvider === 'gemini' && (
                        <>
                          {renderModelIdInput({
                            id: 'heavy-gemini-model',
                            label: 'Gemini Model ID',
                            value: form.geminiModel,
                            provider: 'gemini',
                            apiKey: form.googleApiKey,
                            placeholder: 'gemini-2.5-flash',
                            tourId: 'settings-llm-model',
                            onChange: (value) => handleInput('geminiModel', value),
                          })}

                          <label className={styles.label}>
                            Google API Key
                            <input
                              type="password"
                              className={styles.input}
                              value={form.googleApiKey}
                              onChange={(event) =>
                                handleInput('googleApiKey', event.target.value)
                              }
                              placeholder="AIza..."
                              data-tour-id="settings-llm-api-key"
                            />
                          </label>
                        </>
                      )}

                      {form.llmProvider === 'openai' && (
                        <>
                          <div className={styles.label}>
                            <div className={styles.labelRow}>
                              <span>Base URL</span>
                              <button
                                type="button"
                                className={styles.inlineButton}
                                onClick={() =>
                                  handleInput(
                                    'openaiBaseUrl',
                                    emptySettings.openaiBaseUrl,
                                  )
                                }
                              >
                                Use default OpenAI URL
                              </button>
                            </div>
                            <input
                              type="url"
                              className={styles.input}
                              value={form.openaiBaseUrl}
                              onChange={(event) =>
                                handleInput('openaiBaseUrl', event.target.value)
                              }
                              placeholder="https://api.openai.com/v1"
                              aria-label="Base URL"
                              data-tour-id="settings-llm-base-url"
                            />
                          </div>

                          {renderModelIdInput({
                            id: 'heavy-openai-model',
                            label: 'Model ID',
                            value: form.openaiModel,
                            provider: 'openai',
                            apiKey: form.openaiApiKey,
                            baseUrl: form.openaiBaseUrl,
                            placeholder: 'gpt-4o',
                            tourId: 'settings-llm-model',
                            onChange: (value) => handleInput('openaiModel', value),
                          })}

                          <label className={styles.label}>
                            API Key
                            <input
                              type="password"
                              className={styles.input}
                              value={form.openaiApiKey}
                              onChange={(event) =>
                                handleInput('openaiApiKey', event.target.value)
                              }
                              placeholder="sk-..."
                              data-tour-id="settings-llm-api-key"
                            />
                          </label>
                        </>
                      )}

                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={form.llmUseSameForAllTiers}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              llmUseSameForAllTiers: event.target.checked,
                            }))
                          }
                        />
                        Use this same LLM for medium and light tasks
                      </label>
                      <p className={styles.infoText}>
                        Uncheck to send structured/utility calls to a cheaper or
                        faster model. The Heavy LLM above is always used for
                        creative prose and the pi-agent.
                      </p>

                      {!form.llmUseSameForAllTiers && (
                        <>
                          {renderTierSection(
                            'llmTierMedium',
                            'Medium LLM',
                            'Used for structured JSON: scene breakdowns, prompt refinement, workflow analysis, classification.',
                          )}
                          {renderTierSection(
                            'llmTierLight',
                            'Light LLM',
                            'Used for cheap utility checks: continuity, image review, JSON repair, prompt evaluation.',
                          )}
                        </>
                      )}
                    </>
                  )}
                </fieldset>

                <fieldset className={styles.fieldset}>
                  <legend>VLM (vision judge)</legend>
                  <p className={styles.infoText}>
                    Reads generated images and grades them against the prompt
                    so the agent can flag misses. Independent of LLM and
                    ComfyUI — flip any combo.
                  </p>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={isVlmJudgeOn}
                      onChange={(event) =>
                        onSaveConnection({ vlmJudge: event.target.checked })
                      }
                    />
                    Enable VLM judge
                  </label>
                  {isVlmJudgeOn ? (
                    <>
                  <div className={styles.cloudToggleRow}>
                    <label
                      className={styles.checkboxLabel}
                      title={
                        !account
                          ? 'Sign in to Dhee Cloud to enable Cloud mode'
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={isVlmCloudMode}
                        disabled={!account}
                        onChange={(event) =>
                          handleInput(
                            'vlmBackend',
                            event.target.checked ? 'cloud' : 'local',
                          )
                        }
                      />
                      Use Dhee Cloud for VLM
                    </label>
                    {!account ? (
                      <button
                        type="button"
                        className={styles.inlineSignInButton}
                        onClick={handleInlineSignIn}
                        disabled={signingIn}
                      >
                        {signingIn ? 'Opening…' : 'Sign In'}
                      </button>
                    ) : null}
                  </div>

                  {isVlmCloudMode ? (
                    <p className={styles.infoText}>
                      VLM routes through the Dhee Cloud proxy (uses the
                      desktop token). Model selection is managed by the
                      cloud — no configuration needed.
                    </p>
                  ) : (
                    <>
                      <div className={styles.radios}>
                        <label className={styles.radioLabel}>
                          <input
                            type="radio"
                            className={styles.radioInput}
                            name="vlm-provider"
                            value="gemini"
                            checked={form.vlmProvider === 'gemini'}
                            onChange={() => handleInput('vlmProvider', 'gemini')}
                          />
                          Gemini
                        </label>
                        <label className={styles.radioLabel}>
                          <input
                            type="radio"
                            className={styles.radioInput}
                            name="vlm-provider"
                            value="openai"
                            checked={form.vlmProvider === 'openai'}
                            onChange={() => handleInput('vlmProvider', 'openai')}
                          />
                          OpenAI-Compatible
                        </label>
                      </div>

                      {form.vlmProvider === 'gemini' ? (
                        <>
                          {renderModelIdInput({
                            id: 'vlm-gemini-model',
                            label: 'Gemini Vision Model ID',
                            value: form.vlmModel,
                            provider: 'gemini',
                            apiKey: form.vlmApiKey,
                            placeholder: 'gemini-2.5-pro',
                            onChange: (value) => handleInput('vlmModel', value),
                          })}
                          <label className={styles.label}>
                            Google API Key
                            <input
                              type="password"
                              className={styles.input}
                              value={form.vlmApiKey}
                              onChange={(event) =>
                                handleInput('vlmApiKey', event.target.value)
                              }
                              placeholder="AIza..."
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <label className={styles.label}>
                            Base URL
                            <input
                              type="url"
                              className={styles.input}
                              value={form.vlmBaseUrl}
                              onChange={(event) =>
                                handleInput('vlmBaseUrl', event.target.value)
                              }
                              placeholder="http://127.0.0.1:1234/v1"
                            />
                          </label>
                          {renderModelIdInput({
                            id: 'vlm-openai-model',
                            label: 'Vision Model ID',
                            value: form.vlmModel,
                            provider: 'openai',
                            apiKey: form.vlmApiKey,
                            baseUrl: form.vlmBaseUrl,
                            placeholder: 'qwen-vl-72b',
                            onChange: (value) => handleInput('vlmModel', value),
                          })}
                          <label className={styles.label}>
                            API Key
                            <input
                              type="password"
                              className={styles.input}
                              value={form.vlmApiKey}
                              onChange={(event) =>
                                handleInput('vlmApiKey', event.target.value)
                              }
                              placeholder="sk-..."
                            />
                          </label>
                        </>
                      )}
                      <p className={styles.infoText}>
                        Empty fields fall through to <code>VLM_*</code> env
                        from the engine <code>.env</code> in your <code>dhee-core</code> checkout (dev mode).
                      </p>
                    </>
                  )}
                    </>
                  ) : (
                    <p className={styles.infoText}>
                      VLM judge is off — the agent won&apos;t grade generated
                      images. Enable it above to configure a vision provider.
                    </p>
                  )}
                </fieldset>

                {error && <div className={styles.error}>{error}</div>}
              </>
            )}
          </section>

          {activeTab === 'connection' && (
            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.submitButton}
                disabled={isSavingConnection}
                data-tour-id="settings-save-connection"
              >
                {isSavingConnection ? 'Saving…' : 'Save & Restart'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );

  if (isEmbedded) {
    return panelContent;
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      {panelContent}
    </div>
  );
}
