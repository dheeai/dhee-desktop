import { useEffect, useState } from 'react';
import type {
  AccountInfo,
  AppSettings,
  LLMProvider,
  ThemeId,
} from '../../../shared/settingsTypes';
import { DESKTOP_THEMES } from '../../themes';
import AccountTab from './AccountTab';
import styles from './SettingsPanel.module.scss';

type SettingsTab = 'account' | 'appearance' | 'connection';

type Props = {
  isOpen: boolean;
  variant?: 'modal' | 'embedded';
  settings: AppSettings | null;
  onClose: () => void;
  onThemeChange: (themeId: ThemeId) => Promise<void> | void;
  onSaveConnection: (settings: Partial<AppSettings>) => Promise<boolean> | void;
  isSavingConnection: boolean;
  error?: string | null;
};

const emptySettings: AppSettings = {
  backendMode: 'local',
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

export default function SettingsPanel({
  isOpen,
  variant = 'modal',
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
  const [cloudModeWarning, setCloudModeWarning] = useState<string | null>(null);
  const [pendingCloudSwitch, setPendingCloudSwitch] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  useEffect(() => {
    setForm(normalizeConnectionSettings(settings));
  }, [settings, isVisible]);

  useEffect(() => {
    if (isVisible) {
      setActiveTab('appearance');
    }
  }, [isVisible]);

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
        setCloudModeWarning(null);
        setSignInError(null);
        setPendingCloudSwitch((wasPending) => {
          if (wasPending) {
            setForm((prev) => ({ ...prev, backendMode: 'cloud' }));
          }
          return false;
        });
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
      setPendingCloudSwitch(false);
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
    if (key === 'backendMode' && value === 'cloud' && !account) {
      setCloudModeWarning('Sign in to Kshana Cloud to switch to Cloud mode.');
      setPendingCloudSwitch(true);
      setSignInError(null);
      return;
    }

    if (key === 'backendMode') {
      setCloudModeWarning(null);
      setPendingCloudSwitch(false);
      setSignInError(null);
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
    });
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

  const isCloudMode = form.backendMode === 'cloud';
  const isCloudReady = isCloudMode && Boolean(account);
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
      ? 'The bundled core is running locally while paid calls use Kshana Cloud credits through the proxy.'
      : 'Sign in to Kshana Cloud to route paid calls through the authenticated proxy.'
    : 'The bundled core is running locally with the provider settings shown below.';

  const renderProviderToggle = (provider: LLMProvider, label: string) => (
    <label className={styles.radioLabel}>
      <input
        type="radio"
        className={styles.radioInput}
        name="llm-provider"
        value={provider}
        checked={form.llmProvider === provider}
        disabled={isCloudMode}
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
              Local providers or Kshana Cloud credits
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
                  the runtime fan-out (main.ts → kshanaCoreManager →
                  oversightState) fires.
                */}
                <div className={styles.sectionHeader} style={{ marginTop: 24 }}>
                  <h3>AI Oversight</h3>
                  <p>
                    Pi-agent observes runner events and intervenes when
                    something looks off. VLM provides image descriptions
                    so pi-agent can judge generated assets against the
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
                      <span style={{ fontWeight: 500 }}>Pi-agent oversight</span>
                      <span style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>
                        Auto-engages pi-agent on runner events (failed,
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
                        Vision-LLM describes generated images for
                        pi-agent. Requires VLM_PROVIDER / VLM_API_KEY /
                        VLM_MODEL in .env. Disabled when oversight is
                        off (VLM standalone has no consumer).
                      </span>
                    </span>
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className={styles.sectionHeader}>
                  <h3>Connection</h3>
                  <p>Choose BYO keys or Kshana Cloud credits for paid calls.</p>
                </div>

                <div className={styles.statusCard}>
                  <div className={styles.statusTopRow}>
                    <div>
                      <div className={styles.statusHeader}>
                        Connection Status
                      </div>
                      <div className={styles.statusHeadline}>
                        {statusHeadline}
                      </div>
                      <p className={styles.statusSupportText}>
                        {statusSupportText}
                      </p>
                    </div>
                    <div className={`${styles.statusBadge} ${statusBadgeClass}`}>
                      <span className={styles.statusDot} />
                      {statusLabel}
                    </div>
                  </div>
                </div>

                <fieldset className={`${styles.fieldset} ${styles.modeFieldset}`}>
                  <legend>Backend Mode</legend>
                  <div
                    className={styles.modeSwitch}
                    role="radiogroup"
                    aria-label="Backend Mode"
                  >
                    <label className={styles.radioLabel}>
                      <input
                        type="radio"
                        className={styles.radioInput}
                        name="backend-mode"
                        value="local"
                        checked={form.backendMode === 'local'}
                        onChange={() => handleInput('backendMode', 'local')}
                      />
                      <span className={styles.modeOption}>Local</span>
                    </label>
                    <label className={styles.radioLabel}>
                      <input
                        type="radio"
                        className={styles.radioInput}
                        name="backend-mode"
                        value="cloud"
                        checked={form.backendMode === 'cloud'}
                        onChange={() => handleInput('backendMode', 'cloud')}
                      />
                      <span className={styles.modeOption}>Cloud</span>
                    </label>
                  </div>
                  {cloudModeWarning ? (
                    <div className={styles.inlineSignIn}>
                      <p className={styles.warningText}>{cloudModeWarning}</p>
                      <p className={styles.infoText}>
                        Sign-in opens your browser, then returns here automatically.
                      </p>
                      {signInError ? (
                        <p className={styles.error}>{signInError}</p>
                      ) : null}
                      <button
                        type="button"
                        className={styles.submitButton}
                        onClick={handleInlineSignIn}
                        disabled={signingIn}
                      >
                        {signingIn ? 'Opening Browser…' : 'Sign In to Kshana Cloud'}
                      </button>
                    </div>
                  ) : null}
                </fieldset>

                <div
                  className={`${styles.localSettings} ${
                    isCloudMode ? styles.localSettingsDisabled : ''
                  }`}
                >
                  <label className={styles.label}>
                    ComfyUI URL
                    <input
                      type="url"
                      className={styles.input}
                      value={form.comfyuiUrl}
                      disabled={isCloudMode}
                      onChange={(event) =>
                        handleInput('comfyuiUrl', event.target.value)
                      }
                      placeholder="http://localhost:8000"
                    />
                  </label>

                  <label className={styles.label}>
                    Comfy Cloud API Key
                    <input
                      type="password"
                      className={styles.input}
                      value={form.comfyCloudApiKey}
                      disabled={isCloudMode}
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

                  <fieldset className={styles.fieldset} disabled={isCloudMode}>
                    <legend>LLM Provider</legend>
                    <div className={styles.radios}>
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
                          disabled={isCloudMode}
                          onChange={(event) =>
                            handleInput('googleApiKey', event.target.value)
                          }
                          placeholder="AIza..."
                        />
                      </label>

                      <label className={styles.label}>
                        Gemini Model ID
                        <input
                          type="text"
                          className={styles.input}
                          value={form.geminiModel}
                          disabled={isCloudMode}
                          onChange={(event) =>
                            handleInput('geminiModel', event.target.value)
                          }
                          placeholder="gemini-2.5-flash"
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
                            disabled={isCloudMode}
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
                          disabled={isCloudMode}
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
                          disabled={isCloudMode}
                          onChange={(event) =>
                            handleInput('openaiModel', event.target.value)
                          }
                          placeholder="gpt-4o"
                        />
                      </label>

                      <label className={styles.label}>
                        API Key
                        <input
                          type="password"
                          className={styles.input}
                          value={form.openaiApiKey}
                          disabled={isCloudMode}
                          onChange={(event) =>
                            handleInput('openaiApiKey', event.target.value)
                          }
                          placeholder="sk-..."
                        />
                      </label>
                    </>
                  )}
                </div>

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
