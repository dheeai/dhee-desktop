/**
 * Header-level run control. Always visible while a project is open
 * so the user has a persistent "primary action" surface — they don't
 * have to scroll the chat history to find a Resume CTA.
 *
 * State machine:
 *
 *   project state = 'in_progress', running = false → Run / Resume
 *   project state = 'completed',   running = false → null (hidden)
 *   running = true                                 → Stop (red Square icon)
 *   running = true + user clicked Stop             → Stopping… (spinner)
 *
 * The "Stopping…" state is locally driven — when the user clicks
 * Stop, we flip `pendingCancel` immediately so the click feels
 * responsive even though the abort signal takes a beat to propagate
 * through pi-agent + the executor + ComfyUI / LLM clients. Cleared
 * automatically once `running` flips false.
 */
import { Loader2, Play, Square } from 'lucide-react';
import type { ProjectLifecycleState } from './classifyProjectState';

interface ProjectRunButtonProps {
  /** Lifecycle classification (`null` while the probe is in flight). */
  projectState: ProjectLifecycleState | null;
  /** Whether the kshana session is actively executing a task. */
  running: boolean;
  /** Whether the chat session is ready (sessionId issued, not connecting). */
  ready: boolean;
  /**
   * True from the moment the user clicks Stop until `running` returns
   * to false. Lifted to the parent so the inline stop button (in the
   * textarea) and this header button stay in sync — clicking either
   * shows "Stopping…" on both.
   */
  pendingCancel: boolean;
  /** Fires "kshana_run_to project=… projectDir=…" through the chat. */
  onStart: () => void;
  /** Sends a cancel request. The button immediately flips to
   *  Stopping… until `running` returns false. */
  onCancel: () => void;
}

export default function ProjectRunButton({
  projectState,
  running,
  ready,
  pendingCancel,
  onStart,
  onCancel,
}: ProjectRunButtonProps) {

  // Hide entirely when the project is fresh (the wizard is the right
  // entry point) or completed (no resume to offer; the CTA handles
  // "show final video"). Also hide while the lifecycle probe is
  // pending so the button doesn't flash.
  if (!running) {
    if (projectState !== 'in_progress') return null;
  }

  if (running) {
    const stopping = pendingCancel;
    return (
      <button
        type="button"
        onClick={() => {
          if (stopping) return;
          onCancel();
        }}
        aria-label={stopping ? 'Stopping run' : 'Stop run'}
        title={stopping ? 'Cancelling — finishing the current step…' : 'Stop the current run'}
        disabled={stopping}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'inherit',
          color: '#fff',
          background: stopping ? 'rgba(161,58,58,0.7)' : '#a13a3a',
          border: 'none',
          borderRadius: 6,
          cursor: stopping ? 'progress' : 'pointer',
          transition: 'background 120ms ease',
        }}
      >
        {stopping ? (
          <Loader2 size={13} className="kshana-spin" />
        ) : (
          <Square size={11} fill="currentColor" strokeWidth={0} />
        )}
        <span>{stopping ? 'Stopping…' : 'Stop'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="Resume run"
      title="Resume the pipeline from where you left off"
      disabled={!ready}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        fontSize: 12,
        fontWeight: 500,
        fontFamily: 'inherit',
        color: '#fff',
        background: '#3a7aa1',
        border: 'none',
        borderRadius: 6,
        cursor: ready ? 'pointer' : 'not-allowed',
        opacity: ready ? 1 : 0.5,
        transition: 'background 120ms ease',
      }}
    >
      <Play size={11} fill="currentColor" strokeWidth={0} />
      <span>Resume</span>
    </button>
  );
}
