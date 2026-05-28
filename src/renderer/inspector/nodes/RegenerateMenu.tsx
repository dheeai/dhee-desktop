/**
 * Right-click context menu wrapper. Wraps any card / tile, surfaces a
 * "Regenerate" menu item on contextmenu, calls
 * `useDheeSession().redoNode(nodeId)` on click.
 *
 * For stage cards: parent passes nodeId = bundleNode.id ('plot',
 * 'story', etc.). For collection-rail tiles: nodeId =
 * `${bundleNode.id}:${itemId}` ('shot_image:scene_1_shot_1') — the
 * same shape PromptsView + AssetRegenerateButton use, so the
 * dhee-core redoNode handler routes per-instance regen without
 * needing a separate IPC channel.
 *
 * When nodeId is undefined (e.g. pending instance with no walkState
 * entry yet), the menu is suppressed — there's nothing to regenerate.
 */
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDheeSession } from '../../hooks/useDheeSession';
import styles from './RegenerateMenu.module.scss';

export interface RegenerateMenuProps {
  /** The node id to pass to redoNode. Omit for pending instances. */
  nodeId?: string;
  children: ReactNode;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
}

export function RegenerateMenu({ nodeId, children }: RegenerateMenuProps) {
  const { redoNode } = useDheeSession();
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
    // Fire and forget — the runner status surfaces back through
    // walkState (status: 'running' → 'completed' / 'failed') which
    // re-renders the card automatically via ProjectContext file
    // watching. No explicit toast here in v1.
    void redoNode(nodeId);
    dismiss();
  }, [nodeId, redoNode, dismiss]);

  // Dismiss on escape — keyboard a11y.
  useEffect(() => {
    if (!menu.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu.open, dismiss]);

  return (
    <div onContextMenu={onContextMenu} className={styles.target}>
      {children}
      {menu.open
        // Portal to document.body so the menu escapes any ancestor
        // with a CSS transform. xyflow's viewport is transformed
        // (translate + scale); inside the transform `position: fixed`
        // is relative to the transformed parent, not the viewport,
        // so the menu would land offset from the cursor. Portal lifts
        // it into the body where `fixed` matches clientX/Y as
        // expected.
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
            </div>
          </>,
          document.body,
        )
        : null}
    </div>
  );
}
