/**
 * "Redo from..." dropdown + confirmation modal.
 *
 * The dropdown lives in the PreviewPanel header. Each item is a
 * user-friendly stage label (NO internal typeIds surface to the
 * user). On selection a confirmation modal explains what will be
 * regenerated, warns that the action is non-recoverable, and hints
 * that single-shot edits should go through the chat agent.
 *
 * Actual invalidation goes through the existing
 * `useDheeSession().invalidateNodes(ids)` IPC — same mechanism the
 * chat-driven `/reset` slash command uses. The cascade walks
 * `dependents` server-side via `applyInvalidation`, so we just need
 * to enumerate the top-level node ids matching the chosen stage's
 * typeIds.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ChevronDown, RefreshCw, AlertTriangle, MessageSquare } from 'lucide-react';
import {
  REDO_FROM_STAGES,
  downstreamStages,
  resolveNodeIdsForTypeIds,
  type RedoFromStage,
} from './redoFromStages';
import { useDheeSession } from '../../../hooks/useDheeSession';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { postChatNotice } from '../../../utils/chatNotices';
import styles from './RedoFromMenu.module.scss';

type MenuState =
  | { kind: 'closed' }
  | { kind: 'open' }
  | { kind: 'confirming'; stage: RedoFromStage }
  | { kind: 'running'; stage: RedoFromStage }
  | { kind: 'error'; stage: RedoFromStage; message: string };

export default function RedoFromMenu() {
  const { projectDirectory } = useWorkspace();
  const session = useDheeSession();
  const [state, setState] = useState<MenuState>({ kind: 'closed' });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside-click — only when the dropdown is open (not the
  // modal, which has its own backdrop).
  useEffect(() => {
    if (state.kind !== 'open') return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setState({ kind: 'closed' });
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [state.kind]);

  const onPickStage = useCallback((stage: RedoFromStage) => {
    setState({ kind: 'confirming', stage });
  }, []);

  const onConfirm = useCallback(async () => {
    if (state.kind !== 'confirming' || !projectDirectory) return;
    const stage = state.stage;
    setState({ kind: 'running', stage });

    // Surface the user's intent into the chat window immediately so
    // there's visible feedback even before pi-agent's first text
    // chunk lands. The notice is ephemeral (renderer-only, not
    // persisted to JSONL) — same semantics as the server-side `🛑`
    // cancel notifications.
    postChatNotice({
      level: 'info',
      message: `↻ Redoing from "${stage.label}" — invalidating downstream nodes…`,
    });

    // Read project.json to enumerate the node ids matching the
    // chosen stage's typeIds. The desktop already loads files via
    // window.electron.project.readFile.
    const projectJsonPath = `${projectDirectory}/project.json`;
    const projectJson = await window.electron.project.readFile(projectJsonPath);
    if (!projectJson) {
      const msg = 'Could not read project.json — is the project still selected?';
      postChatNotice({ level: 'error', message: `↻ Redo failed: ${msg}` });
      setState({ kind: 'error', stage, message: msg });
      return;
    }
    const ids = resolveNodeIdsForTypeIds(projectJson, stage.typeIds);
    if (ids.length === 0) {
      const msg =
        'Nothing to redo at this stage yet — it hasn\'t produced any output. ' +
        'Pick a later stage, or dispatch the pipeline first.';
      postChatNotice({ level: 'warning', message: `↻ Redo skipped: ${msg}` });
      setState({ kind: 'error', stage, message: msg });
      return;
    }

    // source='redo_from_menu' tells kshana-core to SKIP emitting the
    // supervisor `user_invalidate` event. Without that skip, pi-agent
    // receives a "DO NOT auto-dispatch" instruction in the same turn
    // as the runTask we send next, and the dispatch silently fails.
    const result = await session.invalidateNodes(ids, {
      source: 'redo_from_menu',
    });
    if (!result.ok) {
      const msg = result.error ?? 'Invalidation failed (no details from server).';
      postChatNotice({ level: 'error', message: `↻ Redo failed: ${msg}` });
      setState({ kind: 'error', stage, message: msg });
      return;
    }
    const invalidatedCount = result.invalidated?.length ?? ids.length;
    postChatNotice({
      level: 'info',
      message:
        `↻ ${invalidatedCount} node${invalidatedCount === 1 ? '' : 's'} marked pending. ` +
        'Dispatching the pipeline to regenerate.',
    });

    // Redo is atomic — the user already confirmed in the modal. Dispatch
    // the continuation run directly. Previously we asked a second
    // "Continue now / Later" question here, but that left users with a
    // half-state (final_video flipped to pending, never re-rendered) when
    // they picked Later, dismissed the question, or pi-agent decided the
    // project was already "complete" and skipped the dispatch. "Redo"
    // should mean "redo".
    const projectDirName =
      projectDirectory.split('/').pop()?.replace(/\.kshana$/i, '') || 'project';
    const params = `project="${projectDirName}" projectDir="${projectDirectory}"`;
    const task =
      `Continue running the kshana pipeline for ${params} all the way to ` +
      'completion. Call dhee_run_to with no stage so it runs every pending ' +
      'node to the end — DO NOT skip the call even if status appears complete, ' +
      'because invalidation just flipped node(s) back to pending. Stream progress ' +
      'as nodes finish.';

    // Close the dialog AS SOON AS the dispatch is kicked off, NOT after
    // the full pi-agent turn finishes. session.runTask() resolves only
    // when the agent's entire conversation completes — invalidate +
    // dispatch + status check + the dispatched dhee_run_to streaming
    // its 70+ nodes back. Waiting on that left the dialog stuck on
    // "Working…" for minutes while the run actually proceeded in the
    // chat panel. The chat already surfaces every step (notices +
    // tool cards + progress chunks); the dialog has no additional
    // signal to add. Errors during the run still land in the chat as
    // a notice via the .catch below.
    void session.runTask(task).then(
      (result) => {
        if (!result.ok) {
          postChatNotice({
            level: 'error',
            message: `↻ Redo dispatch failed: ${result.error ?? 'unknown error'}`,
          });
        }
      },
      (err) => {
        const msg =
          (err instanceof Error ? err.message : String(err)) ||
          'Could not start the run after invalidation. ' +
            'Nodes are marked pending — you can dispatch manually from chat.';
        postChatNotice({
          level: 'error',
          message: `↻ Redo dispatch failed: ${msg}`,
        });
      },
    );
    setState({ kind: 'closed' });
  }, [state, projectDirectory, session]);

  const onCancel = useCallback(() => setState({ kind: 'closed' }), []);

  return (
    <div className={styles.menuWrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setState(state.kind === 'open' ? { kind: 'closed' } : { kind: 'open' })}
        aria-haspopup="menu"
        aria-expanded={state.kind === 'open'}
        disabled={!projectDirectory}
      >
        <RefreshCw size={14} />
        <span>Redo from…</span>
        <ChevronDown size={14} />
      </button>

      {state.kind === 'open' && (
        <div className={styles.menu} role="menu">
          {REDO_FROM_STAGES.map((stage) => (
            <button
              key={stage.key}
              type="button"
              className={styles.menuItem}
              onClick={() => onPickStage(stage)}
              role="menuitem"
            >
              <div>{stage.label}</div>
              <div className={styles.menuItemSecondary}>{stage.description}</div>
            </button>
          ))}
        </div>
      )}

      {(state.kind === 'confirming' ||
        state.kind === 'running' ||
        state.kind === 'error') && (
        <RedoConfirmModal
          stage={state.stage}
          phase={state.kind}
          error={state.kind === 'error' ? state.message : null}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

interface RedoConfirmModalProps {
  stage: RedoFromStage;
  phase: 'confirming' | 'running' | 'error';
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function RedoConfirmModal({
  stage,
  phase,
  error,
  onConfirm,
  onCancel,
}: RedoConfirmModalProps) {
  const downstream = downstreamStages(stage);
  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modalCard}>
        <h2 className={styles.modalTitle}>Redo from: {stage.label}</h2>
        <p className={styles.modalSubtitle}>{stage.description}</p>

        <div className={styles.modalSection}>
          <div className={styles.modalSectionLabel}>The following will be regenerated</div>
          <ul className={styles.modalList}>
            {downstream.map((s) => (
              <li key={s.key}>{s.label}</li>
            ))}
          </ul>
        </div>

        <div className={styles.modalWarning}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            This cannot be undone. Any generated text, images, or videos for the
            stages above will be replaced by fresh outputs on the next run.
          </span>
        </div>

        <div className={styles.modalHint}>
          <MessageSquare size={16} aria-hidden="true" />
          <span>
            Need to redo just one shot? Ask the agent in chat —{' '}
            <code>redo shot 3 image</code> or <code>redo scene 2</code> work too.
          </span>
        </div>

        {error && (
          <div className={styles.modalWarning} role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.modalActions}>
          <button
            type="button"
            className={`${styles.modalButton} ${styles.modalButtonSecondary}`}
            onClick={onCancel}
            disabled={phase === 'running'}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.modalButton} ${styles.modalButtonDanger}`}
            onClick={onConfirm}
            disabled={phase === 'running'}
          >
            {phase === 'running' ? 'Working…' : 'Redo'}
          </button>
        </div>
      </div>
    </div>
  );
}
