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
import styles from './QuickstartTab.module.scss';
import type { AppSettings } from '../../../shared/settingsTypes';

export interface QuickstartTabProps {
  onSave: (patch: Partial<AppSettings>) => Promise<boolean> | void;
  isSaving: boolean;
}

export function QuickstartTab({ onSave, isSaving }: QuickstartTabProps) {
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

      <div className={styles.field}>
        <label htmlFor="quickstart-openrouter-key" className={styles.label}>
          OpenRouter API key
        </label>
        <div className={styles.inputRow}>
          <input
            id="quickstart-openrouter-key"
            type={revealed ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-or-…"
            autoComplete="off"
            spellCheck={false}
            className={styles.input}
          />
          <button
            type="button"
            className={styles.revealButton}
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide key' : 'Show key'}
            title={revealed ? 'Hide key' : 'Reveal key'}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
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
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveButton}
          onClick={handleSave}
          disabled={!canSave}
          aria-label={isSaving ? 'Saving…' : 'Save'}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default QuickstartTab;
