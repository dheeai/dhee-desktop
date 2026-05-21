import { useState, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { useDheeSession } from '../../../hooks/useDheeSession';
import styles from './AssetRegenerateButton.module.scss';

export type AssetRegenerateScope = 'prompt' | 'image_only';
export type AssetRegenerateFrame = 'first_frame' | 'last_frame';

export interface AssetRegenerateButtonProps {
  /**
   * Executor node id to invalidate, e.g.
   *   - 'shot_image:scene_2_shot_4'         (frame regen target)
   *   - 'shot_image_prompt:scene_2_shot_4'  (prompt re-roll target)
   *   - 'shot_video:scene_2_shot_4'         (video regen target)
   */
  nodeId: string;
  /** Surgical-frame selector. Only meaningful with scope='image_only'. */
  frame?: AssetRegenerateFrame;
  /** Surgical scope. Omit for default behavior (full cascade). */
  scope?: AssetRegenerateScope;
  /** Tooltip text shown on hover; describes which downstream rebuilds. */
  label: string;
  /** Visible mini-text next to the icon (optional). */
  caption?: string;
  /** External disabled signal (e.g., node already in_progress). */
  disabled?: boolean;
  /** Called the instant the click is processed (before redoNode resolves). */
  onActionStart?: () => void;
  /** Called when redoNode resolves; ok=false carries the error string. */
  onActionResult?: (ok: boolean, error?: string) => void;
}

export default function AssetRegenerateButton({
  nodeId,
  frame,
  scope,
  label,
  caption,
  disabled,
  onActionStart,
  onActionResult,
}: AssetRegenerateButtonProps) {
  const { sessionId, redoNode } = useDheeSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDisabled = disabled || busy || !sessionId;

  const onClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (isDisabled) return;
      setError(null);
      setBusy(true);
      onActionStart?.();
      try {
        const result = await redoNode(nodeId, {
          ...(frame ? { frame } : {}),
          ...(scope ? { scope } : {}),
        });
        if (!result.ok) {
          const msg = result.error ?? 'redoNode failed';
          setError(msg);
          onActionResult?.(false, msg);
        } else {
          onActionResult?.(true);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        onActionResult?.(false, msg);
      } finally {
        setBusy(false);
      }
    },
    [isDisabled, redoNode, nodeId, frame, scope, onActionStart, onActionResult],
  );

  const displayCaption = busy ? 'Regenerating…' : caption;

  return (
    <button
      type="button"
      className={`${styles.button} ${busy ? styles.busy : ''}`.trim()}
      disabled={isDisabled}
      onClick={onClick}
      title={error ? `${label} — error: ${error}` : label}
      aria-label={label}
      data-testid={`asset-regenerate-${nodeId}${frame ? `-${frame}` : ''}${scope ? `-${scope}` : ''}`}
    >
      <RotateCcw size={12} className={busy ? styles.spin : ''} />
      {displayCaption ? (
        <span className={styles.caption}>{displayCaption}</span>
      ) : null}
    </button>
  );
}
