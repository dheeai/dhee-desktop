/**
 * QuickstartTab — the new first tab in Settings.
 *
 * One input, one button, one happy path: paste OpenRouter key, save,
 * configured. Auto-populates all 3 LLM tiers (heavy/medium/light)
 * with OpenRouter so the user doesn't have to think about tiers.
 *
 * Power users keep using the Connection tab.
 */
import { useState } from 'react';
import { Eye, EyeOff, ExternalLink } from 'lucide-react';
import { Button, Field, Input } from '../ui';
import styles from './QuickstartTab.module.scss';
import type { AppSettings } from '../../../shared/settingsTypes';

export interface QuickstartTabProps {
  onSave: (patch: Partial<AppSettings>) => Promise<boolean> | void;
  isSaving: boolean;
  /** Open the full-screen guided setup (recipe → brain → renderer → pre-flight). */
  onRunGuidedSetup?: () => void;
}

export function QuickstartTab({ onSave, isSaving, onRunGuidedSetup }: QuickstartTabProps) {
  const [key, setKey] = useState('');
  const [revealed, setRevealed] = useState(false);
  const trimmed = key.trim();
  const canSave = trimmed.length > 0 && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    await onSave({
      llmProvider: 'openrouter',
      openRouterApiKey: trimmed,
      llmUseSameForAllTiers: true,
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h3 className={styles.title}>Quickstart</h3>
        <p className={styles.subtitle}>
          The fastest way to get going: one OpenRouter API key powers every
          LLM call (story planning, shot prompts, dialogue). You can fine-tune
          providers per tier in <strong>Connection</strong> later.
        </p>
      </div>

      {onRunGuidedSetup && (
        <div className={styles.guidedCallout}>
          <div className={styles.guidedText}>
            <strong>Reconfiguring, or set up a new machine?</strong>
            <span>
              Run the guided setup — pick a recipe (cloud / hybrid / local), connect your
              LLM and ComfyUI, and verify everything before you render.
            </span>
          </div>
          <Button variant="secondary" onClick={onRunGuidedSetup}>
            Run the guided setup →
          </Button>
        </div>
      )}

      <Field label="OpenRouter API key" htmlFor="quickstart-openrouter-key">
        <div className={styles.inputRow}>
          <Input
            id="quickstart-openrouter-key"
            mono
            style={{ flex: 1 }}
            type={revealed ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-or-…"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            variant="ghost"
            iconOnly
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide key' : 'Show key'}
            title={revealed ? 'Hide key' : 'Reveal key'}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </Button>
        </div>
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.helpLink}
        >
          Get an OpenRouter key
          <ExternalLink size={11} />
        </a>
      </Field>

      <div className={styles.actions}>
        <Button variant="primary" onClick={handleSave} disabled={!canSave}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export default QuickstartTab;
