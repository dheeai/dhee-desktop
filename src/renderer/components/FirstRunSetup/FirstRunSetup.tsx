/**
 * FirstRunSetup — full-screen, can't-miss first-run flow that DRIVES
 * and VERIFIES the three-lane config (instead of the passive coachmark
 * tour). Recipe → brain (LLM) → renderer (ComfyUI) → pre-flight, then
 * applies the recipe's AppSettings patch in one update and hands off to
 * the normal New Project flow (where the Bundle Configurator runs).
 */
import { useCallback, useEffect, useState } from 'react';
import { Cloud, Shuffle, Cpu, type LucideIcon } from 'lucide-react';
import type { AccountInfo, AppSettings, LLMProvider } from '../../../shared/settingsTypes';
import { isLocalLlmUrl } from '../../../shared/localUrl';
import type { ComfyProbeResult } from '../../../shared/bundleConfigTypes';
import type { LlmProbeResult, ProviderDiagnosticsSnapshot } from '../../../shared/providerDiagnosticsTypes';
import { useFirstRunSetup } from '../../contexts/FirstRunSetupContext';
import { Button, SegmentedControl, Field, Input } from '../ui';
import { buildSetupPatch, type Recipe, type LocalLlmConfig } from './recipePresets';
import styles from './FirstRunSetup.module.scss';

type Step = 'recipe' | 'brain' | 'renderer' | 'preflight';

const RECIPES: Array<{ id: Recipe; icon: LucideIcon; title: string; blurb: string; eta: string }> = [
  { id: 'cloud', icon: Cloud, title: 'Run on Dhee Cloud', blurb: 'Everything runs on our GPUs. Nothing to install.', eta: '~30s' },
  { id: 'hybrid', icon: Shuffle, title: 'Hybrid', blurb: 'Cloud writes & directs; your GPU renders in ComfyUI.', eta: '~90s' },
  { id: 'local', icon: Cpu, title: 'Fully local / BYO keys', blurb: 'Your machine, your keys, your ComfyUI.', eta: '~2 min' },
];

const PROVIDERS: Array<{ id: LLMProvider; label: string; tag: string }> = [
  { id: 'openai', label: 'OpenAI-compatible', tag: 'url' },
  { id: 'gemini', label: 'Gemini', tag: 'key' },
];

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Base-URL presets for the OpenAI-compatible provider. They just seed the
 * editable base URL — OpenAI/OpenRouter are remote (key required), the
 * local one needs none.
 */
const BASE_URL_PRESETS: Array<{ label: string; url: string }> = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'Local', url: 'http://127.0.0.1:1234/v1' },
];


/** The stored key/model/base-url for a provider, so the flow prefills what's already configured. */
export function providerFieldsFromSettings(
  provider: LLMProvider,
  s: Partial<AppSettings>,
): { apiKey: string; model: string; baseUrl: string } {
  if (provider === 'gemini') {
    return { apiKey: s.googleApiKey ?? '', model: s.geminiModel ?? '', baseUrl: '' };
  }
  return {
    apiKey: s.openaiApiKey ?? '',
    model: s.openaiModel ?? '',
    baseUrl: s.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL,
  };
}

export default function FirstRunSetup() {
  const { complete } = useFirstRunSetup();
  const [step, setStep] = useState<Step>('recipe');
  const [recipe, setRecipe] = useState<Recipe | null>(null);

  // brain (cloud)
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [waitingAuth, setWaitingAuth] = useState(false);
  // brain (local)
  const [provider, setProvider] = useState<LLMProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_OPENAI_BASE_URL);
  // brain (local) — Test connection probe of the in-form LLM config.
  const [llmProbe, setLlmProbe] = useState<LlmProbeResult | null>(null);
  const [llmProbing, setLlmProbing] = useState(false);
  // Snapshot of current settings so the flow prefills what's already stored.
  const [snapshot, setSnapshot] = useState<Partial<AppSettings> | null>(null);

  // renderer (local)
  const [comfyUrl, setComfyUrl] = useState('http://127.0.0.1:8188');
  const [probe, setProbe] = useState<ComfyProbeResult | null>(null);
  const [probing, setProbing] = useState(false);

  // preflight
  const [applying, setApplying] = useState(false);
  const [diag, setDiag] = useState<ProviderDiagnosticsSnapshot | null>(null);

  const isCloudLlm = recipe === 'cloud' || recipe === 'hybrid';
  const isLocalComfy = recipe === 'hybrid' || recipe === 'local';

  // Prefill from existing settings so re-runs show what's already
  // configured (provider + key + model + comfy URL), and from the
  // current account so an already-signed-in user sees their chip.
  useEffect(() => {
    let cancelled = false;
    void window.electron.settings
      .get()
      .then((s) => {
        if (cancelled) return;
        setSnapshot(s);
        const p: LLMProvider = s.llmProvider === 'gemini' ? 'gemini' : 'openai';
        setProvider(p);
        const f = providerFieldsFromSettings(p, s);
        setApiKey(f.apiKey);
        setModel(f.model);
        if (f.baseUrl) setBaseUrl(f.baseUrl);
        if (s.comfyuiMode === 'custom' && s.comfyuiUrl) setComfyUrl(s.comfyuiUrl);
      })
      .catch(() => undefined);
    void window.electron.account
      .get()
      .then((acct) => {
        if (!cancelled && acct) setAccount(acct);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Switching provider shows THAT provider's stored key/model/base-url.
  const chooseProvider = (p: LLMProvider) => {
    setProvider(p);
    const f = providerFieldsFromSettings(p, snapshot ?? {});
    setApiKey(f.apiKey);
    setModel(f.model);
    if (f.baseUrl) setBaseUrl(f.baseUrl);
  };

  // Poll for the account after sign-in (arrives via browser deep-link).
  useEffect(() => {
    if (!waitingAuth) return undefined;
    const timer = setInterval(async () => {
      const acct = await window.electron.account.get().catch(() => null);
      if (acct) {
        setAccount(acct);
        setWaitingAuth(false);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [waitingAuth]);

  const localLlm = useCallback((): LocalLlmConfig => {
    if (provider === 'gemini') {
      return { provider, googleApiKey: apiKey, ...(model ? { geminiModel: model } : {}) };
    }
    return {
      provider: 'openai',
      openaiApiKey: apiKey,
      ...(baseUrl ? { openaiBaseUrl: baseUrl } : {}),
      ...(model ? { openaiModel: model } : {}),
    };
  }, [provider, apiKey, model, baseUrl]);

  // OpenAI-compatible with a local base URL accepts no key; everything
  // else (remote OpenAI/OpenRouter, Gemini) requires one.
  const keyRequired = provider === 'gemini' || !isLocalLlmUrl(baseUrl);

  // Models the server reported on a successful "Test connection" — offered
  // as a picker instead of a blank free-text box.
  const detectedModels = llmProbe && llmProbe.ok && llmProbe.models ? llmProbe.models : [];

  const steps: Step[] = recipe === 'cloud' ? ['recipe', 'brain', 'preflight'] : ['recipe', 'brain', 'renderer', 'preflight'];
  const stepIdx = steps.indexOf(step);

  const canAdvance = (): boolean => {
    switch (step) {
      case 'recipe':
        return !!recipe;
      case 'brain':
        return isCloudLlm ? !!account : !keyRequired || apiKey.trim().length > 0;
      case 'renderer':
        return !isLocalComfy || (probe?.ok ?? false);
      case 'preflight':
        return true;
    }
  };

  const goNext = () => {
    if (stepIdx < steps.length - 1) setStep(steps[stepIdx + 1]!);
  };
  const goBack = () => {
    if (stepIdx > 0) setStep(steps[stepIdx - 1]!);
  };

  const runProbe = async () => {
    setProbing(true);
    const res = await window.electron.bundleConfig.probeComfy(comfyUrl).catch(
      (e): ComfyProbeResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    setProbe(res);
    setProbing(false);
  };

  // A stale "Connected ✓" must not linger after the config changes.
  useEffect(() => {
    setLlmProbe(null);
  }, [provider, apiKey, model, baseUrl]);

  const runLlmProbe = async () => {
    setLlmProbing(true);
    const res = await window.electron.providerDiagnostics
      .probeLlm({ provider, apiKey, model, baseUrl })
      .catch(
        (e): LlmProbeResult => ({
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    setLlmProbe(res);
    setLlmProbing(false);
  };

  const applyAndDiagnose = useCallback(async () => {
    if (!recipe) return;
    setApplying(true);
    const patch = buildSetupPatch({
      recipe,
      ...(isLocalComfy ? { comfyuiUrl: comfyUrl } : {}),
      ...(recipe === 'local' ? { llm: localLlm() } : {}),
    });
    try {
      await window.electron.settings.update(patch);
      const snap = await window.electron.providerDiagnostics.run();
      setDiag(snap);
    } catch {
      setDiag(null);
    } finally {
      setApplying(false);
    }
  }, [recipe, isLocalComfy, comfyUrl, localLlm]);

  // On entering pre-flight, apply settings + run diagnostics once.
  useEffect(() => {
    if (step === 'preflight') void applyAndDiagnose();
  }, [step, applyAndDiagnose]);

  const signIn = async () => {
    setWaitingAuth(true);
    await window.electron.account.signIn().catch(() => setWaitingAuth(false));
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.grain} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.frame}>
        <header className={styles.header}>
          <span className={styles.wordmark}>Dhee Studio</span>
          <span className={styles.kicker}>First-run setup</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.skip} onClick={() => void complete('skipped')}>
            Skip for now →
          </button>
        </header>

        <div className={styles.progress}>
          <span className={styles.progressCount}>
            {String(stepIdx + 1).padStart(2, '0')}
            <span className={styles.progressTotal}> / {String(steps.length).padStart(2, '0')}</span>
          </span>
          <div className={styles.progressTrack}>
            <i style={{ width: `${(stepIdx / (steps.length - 1)) * 100}%` }} />
          </div>
        </div>

        <main className={styles.body}>
          {step === 'recipe' && (
            <section>
              <h1 className={styles.title}>Let&apos;s light the set.</h1>
              <p className={styles.lede}>Pick how you want to power Dhee. You can change any of this later in Settings.</p>
              <div className={styles.recipes}>
                {RECIPES.map((r) => {
                  const Icon = r.icon;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`${styles.recipe} ${recipe === r.id ? styles.recipeSel : ''}`}
                      onClick={() => setRecipe(r.id)}
                    >
                      <Icon className={styles.recipeIcon} size={22} strokeWidth={1.6} aria-hidden="true" />
                      <span className={styles.recipeTitle}>{r.title}</span>
                      <span className={styles.recipeBlurb}>{r.blurb}</span>
                      <span className={styles.recipeEta}>Ready in {r.eta}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {step === 'brain' && (
            <section>
              <h1 className={styles.title}>Connect the language model.</h1>
              <p className={styles.lede}>It writes your plot, scenes, and every shot prompt.</p>
              {isCloudLlm ? (
                <div className={styles.panel}>
                  {account ? (
                    <div className={styles.acct}>
                      <div className={styles.avatar}>{account.email.charAt(0).toUpperCase()}</div>
                      <div>
                        <b>{account.email}</b>
                        <div className={styles.muted}>Signed in · cloud brain ready</div>
                      </div>
                    </div>
                  ) : (
                    <Button variant="primary" onClick={() => void signIn()} disabled={waitingAuth}>
                      {waitingAuth ? 'Waiting for browser…' : 'Sign in with Dhee →'}
                    </Button>
                  )}
                </div>
              ) : (
                <div className={styles.panel}>
                  <SegmentedControl<LLMProvider>
                    aria-label="Language model provider"
                    value={provider}
                    onChange={chooseProvider}
                    options={PROVIDERS.map((p) => ({ value: p.id, label: p.label, tag: p.tag }))}
                  />
                  {provider === 'openai' && (
                    <Field label="OpenAI-compatible base URL">
                      <Input mono value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                      <div className={styles.row}>
                        {BASE_URL_PRESETS.map((preset) => (
                          <Button
                            key={preset.label}
                            variant="ghost"
                            onClick={() => setBaseUrl(preset.url)}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    </Field>
                  )}
                  <Field label={keyRequired ? 'API key' : 'API key (optional for local servers)'}>
                    <Input
                      mono
                      type="password"
                      placeholder={keyRequired ? 'sk-…' : 'leave blank if your server needs none'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </Field>
                  <Field label="Model (optional — sensible default used)">
                    {detectedModels.length > 0 ? (
                      <select
                        className={styles.modelSelect}
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        <option value="">Auto · sensible default</option>
                        {detectedModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input placeholder="default" value={model} onChange={(e) => setModel(e.target.value)} />
                    )}
                  </Field>
                  <div className={styles.row}>
                    <Button variant="ghost" onClick={() => void runLlmProbe()} disabled={llmProbing}>
                      {llmProbing ? 'Testing…' : 'Test connection'}
                    </Button>
                    <span className={styles.muted}>Optional — also verified at pre-flight.</span>
                  </div>
                  {llmProbe?.ok && <div className={styles.probeOk}>✓ {llmProbe.message}</div>}
                  {llmProbe && !llmProbe.ok && (
                    <div className={styles.probeErr}>
                      {llmProbe.message}
                      {llmProbe.detail && <div className={styles.muted}>{llmProbe.detail}</div>}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {step === 'renderer' && (
            <section>
              <h1 className={styles.title}>Connect ComfyUI.</h1>
              <p className={styles.lede}>The GPU engine that paints frames and renders motion.</p>
              <div className={styles.panel}>
                <Field label="ComfyUI server URL">
                  <div className={styles.row}>
                    <Input mono style={{ flex: 1 }} value={comfyUrl} onChange={(e) => setComfyUrl(e.target.value)} />
                    <Button variant="ghost" onClick={() => void runProbe()} disabled={probing}>
                      {probing ? 'Probing…' : 'Test connection'}
                    </Button>
                  </div>
                </Field>
                {probe?.ok && (
                  <div className={styles.probeOk}>
                    ✓ Connected{probe.version ? ` · ComfyUI ${probe.version}` : ''}
                    {probe.gpuName ? ` · ${probe.gpuName}` : ''}
                    {probe.vramGb ? ` · ${probe.vramGb} GB` : ''} · {probe.modelCount} models · {probe.nodeClasses} node classes
                  </div>
                )}
                {probe && !probe.ok && (
                  <div className={styles.probeErr}>
                    Couldn&apos;t reach ComfyUI: {probe.error}
                    <div className={styles.muted}>
                      The running ComfyUI app <em>is</em> the API. Another machine? Relaunch with{' '}
                      <code>--listen 0.0.0.0</code> and use that host.
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {step === 'preflight' && (
            <section>
              <h1 className={styles.title}>All systems go.</h1>
              <p className={styles.lede}>A live check of every lane before you spend a credit or GPU-second.</p>
              <div className={styles.panel}>
                {applying && <div className={styles.muted}>Applying settings + checking providers…</div>}
                {diag?.items?.map((item) => {
                  const dotClass =
                    item.status === 'ready'
                      ? styles.ready
                      : item.status === 'warning'
                        ? styles.warning
                        : item.status === 'error'
                          ? styles.error
                          : '';
                  return (
                    <div key={item.id} className={styles.lightRow}>
                      <span className={`${styles.dot} ${dotClass}`} />
                      <b>{item.label}</b>
                      <span className={styles.muted}>{item.message}</span>
                    </div>
                  );
                })}
                {!applying && !diag && <div className={styles.muted}>Diagnostics unavailable in this build — your settings were applied.</div>}
              </div>
            </section>
          )}
        </main>

        <footer className={styles.footer}>
          <Button variant="ghost" style={{ marginRight: 'auto' }} onClick={goBack} disabled={stepIdx === 0}>
            ← Back
          </Button>
          {step === 'preflight' ? (
            <Button variant="primary" onClick={() => void complete('manual_finish')} disabled={applying}>
              Create your first project →
            </Button>
          ) : (
            <Button variant="primary" onClick={goNext} disabled={!canAdvance()}>
              Continue
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
