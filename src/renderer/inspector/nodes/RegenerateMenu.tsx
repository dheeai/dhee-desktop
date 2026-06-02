/**
 * Right-click context menu for canvas cards + rail tiles.
 *
 * Items:
 *   - Regenerate        — fire-and-forget redoNode IPC
 *   - Open in Finder    — reveal the artifact in the OS file viewer
 *                         (only when outputPath is known)
 *   - Copy path         — copy the absolute artifact path to clipboard
 *                         (only when outputPath is known)
 *   - Invalidate        — mark this node pending (without running)
 *
 * Per the binary-workspace UX-8 task: discoverability + power-user
 * affordances. Keeps the menu compact (4 items max) — destructive
 * "delete file" intentionally NOT here.
 */
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDheeSession } from '../../hooks/useDheeSession';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import styles from './RegenerateMenu.module.scss';

export interface RegenerateMenuProps {
  /** The node id to pass to redoNode / invalidateNodes. Omit for pending instances. */
  nodeId?: string;
  /** Relative artifact path (walkState outputPath). Powers Open in Finder + Copy path. */
  outputPath?: string;
  children: ReactNode;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
}

export function RegenerateMenu({ nodeId, outputPath, children }: RegenerateMenuProps) {
  const { sessionId, redoNode } = useDheeSession();
  const { projectDirectory } = useWorkspace();
  const [menu, setMenu] = useState<MenuState>({ open: false, x: 0, y: 0 });

  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!nodeId) return;
      event.preventDefault();
      event.stopPropagation();
      setMenu({ open: true, x: event.clientX, y: event.clientY });
    },
    [nodeId],
  );

  const dismiss = useCallback(() => setMenu((m) => ({ ...m, open: false })), []);

  const onRegenerate = useCallback(() => {
    if (!nodeId) return;
    void redoNode(nodeId);
    dismiss();
  }, [nodeId, redoNode, dismiss]);

  const onRevealInFinder = useCallback(() => {
    if (!outputPath || !projectDirectory) return;
    const absPath = `${projectDirectory}/${outputPath}`;
    void window.electron?.project?.revealInFinder?.(absPath);
    dismiss();
  }, [outputPath, projectDirectory, dismiss]);

  const onCopyPath = useCallback(() => {
    if (!outputPath || !projectDirectory) return;
    const absPath = `${projectDirectory}/${outputPath}`;
    void navigator.clipboard?.writeText(absPath);
    dismiss();
  }, [outputPath, projectDirectory, dismiss]);

  const onInvalidate = useCallback(() => {
    if (!nodeId || !sessionId) return;
    void window.dhee?.invalidateNodes?.({
      sessionId,
      nodeIds: [nodeId],
      source: 'inspector_context_menu',
    });
    dismiss();
  }, [nodeId, sessionId, dismiss]);

  useEffect(() => {
    if (!menu.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu.open, dismiss]);

  const canRevealOrCopy = !!outputPath && !!projectDirectory;

  return (
    <div onContextMenu={onContextMenu} className={styles.target}>
      {children}
      {menu.open
        ? createPortal(
          <>
            <div
              className={styles.backdrop}
              data-testid="regenerate-backdrop"
              onClick={dismiss}
            />
            <div
              className={styles.menu}
              style={{ left: menu.x, top: menu.y }}
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={onRegenerate}
              >
                Regenerate
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={onRevealInFinder}
                disabled={!canRevealOrCopy}
                title={canRevealOrCopy ? 'Reveal in Finder' : 'No artifact yet'}
              >
                Open in Finder
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={onCopyPath}
                disabled={!canRevealOrCopy}
                title={canRevealOrCopy ? 'Copy file path' : 'No artifact yet'}
              >
                Copy path
              </button>
              <div className={styles.divider} role="separator" />
              <button
                type="button"
                role="menuitem"
                className={`${styles.item} ${styles.itemDestructive}`}
                onClick={onInvalidate}
              >
                Invalidate (mark pending)
              </button>
            </div>
          </>,
          document.body,
        )
        : null}
    </div>
  );
}
