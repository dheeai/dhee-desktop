import { useEffect, useState } from 'react';
import type {
  AccountInfo,
  AppSettings,
  LLMProvider,
  LLMTierConfig,
  ThemeId,
} from '../../../shared/settingsTypes';
import type {
  ProviderDiagnosticItem,
  ProviderDiagnosticsSnapshot,
  ProviderDiagnosticStatus,
} from '../../../shared/providerDiagnosticsTypes';
import { DESKTOP_THEMES } from '../../themes';
import AccountTab from './AccountTab';
import WorkflowsTab from './WorkflowsTab';
import styles from './SettingsPanel.module.scss';

type SettingsTab =
  | 'account'
  | 'appearance'
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
  comfyCloudApiKey: '',
  comfyuiTimeout: 1800,
  llmProvider: 'openai',
  lmStudioUrl: 'http://127.0.0.1:1234',
  lmStudioModel: 'qwen3',
  googleApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o',
  openRouterApiKey: '',
  openRouterModel: 'z-ai/glm-4.7-flash',
  themeId: 'studio-neutral',
  piOversight: true,
  vlmJudge: true,
  vlmProvider: 'openai',
  vlmBaseUrl: '',
  vlmApiKey: '',
  vlmModel: '',
  llmUseSameForAllTiers: true,
  llmTierMedium: { ...emptyTierConfig },
  llmTierLight: { ...emptyTierConfig },
};

function withV1Suffix(url: string): string {
  return /\/v1\/?$/.test(url) ? url : `${url.replace(/\/$/, '')}/v1`;
}

function normalizeConnectionSettings(input: AppSettings | null): AppSettings {
  const next = input ?? emptySettings;
  const comfyuiUrl = (next.comfyuiUrl || '').trim();
  const backendMode = next.backendMode === 'cloud' ? 'cloud' : 'local';
  const llmProvider =
    next.llmProvider === 'openrouter' || next.llmProvider === 'lmstudio'
      ? 'openai'
      : next.llmProvider;
  const openaiApiKey =
    llmProvider === 'openai' && next.llmProvider === 'openrouter'
      ? next.openRouterApiKey || next.openaiApiKey
      : next.openaiApiKey;
  const openaiBaseUrl =
    llmProvider === 'openai' && next.llmProvider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : llmProvider === 'openai' && next.llmProvider === 'lmstudio'
        ? withV1Suffix(next.lmStudioUrl || emptySettings.lmStudioUrl)
        : next.openaiBaseUrl;
  const openaiModel =
    llmProvider === 'openai' && next.llmProvider === 'openrouter'
      ? next.openRouterModel || next.openaiModel
      : llmProvider === 'openai' && next.llmProvider === 'lmstudio'
        ? next.lmStudioModel || next.openaiModel
        : next.openaiModel;

  return {
    ...emptySettings,
    ...next,
    backendMode,
    llmProvider,
    comfyuiMode: comfyuiUrl ? 'custom' : 'inherit',
    comfyuiUrl,
    comfyCloudApiKey: next.comfyCloudApiKey ?? '',
    lmStudioUrl: next.lmStudioUrl?.trim() || emptySettings.lmStudioUrl,
    lmStudioModel: next.lmStudioModel?.trim() || emptySettings.lmStudioModel,
    googleApiKey: next.googleApiKey ?? '',
    geminiModel: next.geminiModel?.trim() || emptySettings.geminiModel,
    openaiApiKey: openaiApiKey ?? '',
    openaiBaseUrl: openaiBaseUrl?.trim() || emptySettings.openaiBaseUrl,
    openaiModel: openaiModel?.trim() || emptySettings.openaiModel,
    openRouterApiKey: next.openRouterApiKey ?? '',
    openRouterModel:
      next.openRouterModel?.trim() || emptySettings.openRouterModel,
  };
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
  initialTab = 'appearance',
  settings,
  onClose,
  onThemeChange,
  onSaveConnection,
  isSavingConnection,
  error,
}: Props) {
  const isEmbedded = variant === 'embedded';
  const isVisible = isEmbedded || isOpen;
  const [form, setForm] = useState<AppSettings>(
    normalizeConnectionSettings(settings),
  );
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
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
    value: string | number | undefined,
  ) => {
    // Defense-in-depth: the cloud-lane checkboxes are `disabled` when
    // !account so this branch is normally unreachable from the UI, but
    // a stray IPC / programmatic update should still be rejected.
    const isLaneToggle =
      key === 'llmBackend' || key === 'comfyBackend' || key === 'vlmBackend';
    if (isLaneToggle && value === 'cloud' && !account) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const saveConnectionSettings = async (nextForm: AppSettings) => {
    const normalized = normalizeConnectionSettings(nextForm);
    await onSaveConnection({
      backendMode: normalized.backendMode,
      llmBackend: normalized.llmBackend,
      comfyBackend: normalized.comfyBackend,
      vlmBackend: normalized.vlmBackend,
      comfyuiMode: normalized.comfyuiUrl ? 'custom' : 'inherit',
      comfyuiUrl: normalized.comfyuiUrl,
      comfyCloudApiKey: normalized.comfyCloudApiKey,
      llmProvider: normalized.llmProvider,
      lmStudioUrl: normalized.lmStudioUrl,
      lmStudioModel: normalized.lmStudioModel,
      googleApiKey: normalized.googleApiKey,
      geminiModel: normalized.geminiModel,
      openaiApiKey: normalized.openaiApiKey,
      openaiBaseUrl: normalized.openaiBaseUrl,
      openaiModel: normalized.openaiModel,
      openRouterApiKey: normalized.openRouterApiKey,
      openRouterModel: normalized.openRouterModel,
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
  const isComfyCloudMode = form.comfyBackend === 'cloud';
  const isLlmCloudMode = form.llmBackend === 'cloud';
  const isVlmCloudMode = form.vlmBackend === 'cloud';
  const statusLabel = isCloudReady || !isCloudMode ? 'Ready' : 'Sign in';
  const statusBadgeClass = isCloudReady || !isCloudMode
    ? styles.statusBadgeSuccess
    : styles.statusBadgeWarning;
  const statusHeadline = isCloudMode
    ? isCloudReady
      ? 'Connected to Cloud'
      : 'Cloud sign-in required'
    : 'Connected to Local';
  const statusSupportText = isCloudMode
    ? isCloudReady
      ? 'The bundled core is running locally while paid calls use Dhee Cloud credits through the proxy.'
      : 'Sign in to Dhee Cloud to route paid calls through the authenticated proxy.'
    : 'The bundled core is running locally with the provider settings shown below.';

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
            <label className={styles.label}>
              Gemini Model ID
              <input
                type="text"
                className={styles.input}
                value={cfg.geminiModel}
                disabled={isLlmCloudMode}
                onChange={(event) =>
                  handleTierInput(tier, 'geminiModel', event.target.value)
                }
                placeholder="gemini-2.5-flash"
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
            <label className={styles.label}>
              Model ID
              <input
                type="text"
                className={styles.input}
                value={cfg.openaiModel}
                disabled={isLlmCloudMode}
                onChange={(event) =>
                  handleTierInput(tier, 'openaiModel', event.target.value)
                }
                placeholder="gpt-4o"
              />
            </label>
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
            className={`${styles.tabButton} ${activeTab === 'account' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('account')}
          >
            <span className={styles.tabLabel}>Account</span>
            <span className={styles.tabDescription}>Sign-in and credits</span>
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'appearance' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <span className={styles.tabLabel}>Appearance</span>
            <span className={styles.tabDescription}>
              Themes and visual preferences
            </span>
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
            ) : activeTab === 'appearance' ? (
              <>
                <div className={styles.sectionHeader}>
                  <h3>Appearance</h3>
                  <p>
                    Choose a workspace palette tuned for long editing sessions.
                  </p>
                </div>
                <div className={styles.themeGrid}>
                  {DESKTOP_THEMES.map((theme) => {
                    const isActive =
                      (settings?.themeId ?? emptySettings.themeId) === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        className={`${styles.themeCard} ${isActive ? styles.themeCardActive : ''}`}
                        onClick={() => onThemeChange(theme.id)}
                      >
                        <span className={styles.themePreview}>
                          {theme.swatches.map((swatch) => (
                            <span
                              key={swatch}
                              className={styles.themeSwatch}
                              style={{ backgroundColor: swatch }}
                            />
                          ))}
                        </span>
                        <span className={styles.themeMeta}>
                          <span className={styles.themeName}>{theme.name}</span>
                          <span className={styles.themeDescription}>
                            {theme.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/*
                  AI Oversight toggles. Global preferences (apply to
                  all projects). Both default ON. VLM is gated by the
                  supervisor toggle — disabled here when supervisor
                  is off, mirroring the chat-header quick-toggle.
                  Saves immediately on click via onSaveConnection so
                  the runtime fan-out (main.ts → dheeCoreManager →
                  oversightState) fires.
                */}
                <div className={styles.sectionHeader} style={{ marginTop: 24 }}>
                  <h3>AI Oversight</h3>
                  <p>
                    The agent observes runner events and intervenes when
                    something looks off. VLM provides image descriptions
                    so the agent can judge generated assets against the
                    prompt.
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={
                        settings?.piOversight ?? emptySettings.piOversight
                      }
                      onChange={(event) =>
                        onSaveConnection({ piOversight: event.target.checked })
                      }
                      style={{ marginTop: 4 }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 500 }}>Agent oversight</span>
                      <span style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>
                        Auto-engages the agent on runner events (failed,
                        completed, per-asset when VLM is on).
                      </span>
                    </span>
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      cursor: (settings?.piOversight ?? true)
                        ? 'pointer'
                        : 'not-allowed',
                      opacity: (settings?.piOversight ?? true) ? 1 : 0.5,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={settings?.vlmJudge ?? emptySettings.vlmJudge}
                      disabled={!(settings?.piOversight ?? true)}
                      onChange={(event) =>
                        onSaveConnection({ vlmJudge: event.target.checked })
                      }
                      style={{ marginTop: 4 }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 500 }}>VLM judge</span>
                      <span style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>
                        Vision-LLM describes generated images for the
                        agent. Configure the VLM provider in the Connection
                        tab. Disabled when oversight is off (VLM standalone
                        has no consumer).
                      </span>
                    </span>
                  </label>
                </div>
              </>
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
                      title={
                        !account
                          ? 'Sign in to Dhee Cloud to enable Cloud mode'
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={isComfyCloudMode}
                        disabled={!account}
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
                    {isComfyCloudMode
                      ? 'Image / video jobs run on Dhee Cloud (uses credits).'
                      : 'Image / video jobs run on the ComfyUI server below.'}
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

                          <label className={styles.label}>
                            Gemini Model ID
                            <input
                              type="text"
                              className={styles.input}
                              value={form.geminiModel}
                              onChange={(event) =>
                                handleInput('geminiModel', event.target.value)
                              }
                              placeholder="gemini-2.5-flash"
                              data-tour-id="settings-llm-model"
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
                            />
                          </div>

                          <label className={styles.label}>
                            Model ID
                            <input
                              type="text"
                              className={styles.input}
                              value={form.openaiModel}
                              onChange={(event) =>
                                handleInput('openaiModel', event.target.value)
                              }
                              placeholder="gpt-4o"
                              data-tour-id="settings-llm-model"
                            />
                          </label>

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
                    so the agent can flag misses. Toggle the VLM judge in the
                    Appearance tab; configure the provider here. Independent
                    of LLM and ComfyUI — flip any combo.
                  </p>
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
                          <label className={styles.label}>
                            Gemini Vision Model ID
                            <input
                              type="text"
                              className={styles.input}
                              value={form.vlmModel}
                              onChange={(event) =>
                                handleInput('vlmModel', event.target.value)
                              }
                              placeholder="gemini-2.5-pro"
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
                          <label className={styles.label}>
                            Vision Model ID
                            <input
                              type="text"
                              className={styles.input}
                              value={form.vlmModel}
                              onChange={(event) =>
                                handleInput('vlmModel', event.target.value)
                              }
                              placeholder="qwen-vl-72b"
                            />
                          </label>
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
