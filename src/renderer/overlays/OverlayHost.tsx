/**
 * OverlayHost — renders the currently-open overlay above the
 * workspace canvas + chat.
 *
 * Binary-workspace policy (2026-05-28): every "tab-shaped"
 * functional surface — Settings, Library, Plans, Timeline — now
 * lives behind an overlay, opened from the StatusStrip or via
 * Inspector node clicks. OverlayHost mounts the right component
 * based on `useOverlay().current`.
 *
 * Dismiss surfaces: Escape key, backdrop click, explicit close
 * button. Click on the frame itself does NOT dismiss (so the user
 * doesn't lose work by mis-clicking).
 */
import { useEffect, type ReactNode, type MouseEvent } from 'react';
import { X } from 'lucide-react';
import { useOverlay, type OverlayKey } from './OverlayContext';
import SettingsOverlay from './adapters/SettingsOverlay';
import LibraryOverlay from './adapters/LibraryOverlay';
import PlansOverlay from './adapters/PlansOverlay';
import TimelineOverlay from './adapters/TimelineOverlay';
import styles from './OverlayHost.module.scss';

const TITLES: Record<OverlayKey, string> = {
  settings: 'Settings',
  library: 'Library',
  plans: 'Plans',
  timeline: 'Timeline',
};

function renderContent(key: OverlayKey): ReactNode {
  switch (key) {
    case 'settings':
      return <SettingsOverlay />;
    case 'library':
      return <LibraryOverlay />;
    case 'plans':
      return <PlansOverlay />;
    case 'timeline':
      return <TimelineOverlay />;
  }
}

export function OverlayHost() {
  const { current, close } = useOverlay();

  // Escape closes regardless of focus state.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, close]);

  if (!current) return null;

  const stopBubble = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className={styles.host} role="dialog" aria-modal="true" aria-label={TITLES[current]}>
      <div
        className={styles.backdrop}
        data-testid="overlay-backdrop"
        onClick={close}
      />
      <div
        className={styles.frame}
        data-testid="overlay-frame"
        onClick={stopBubble}
      >
        <div className={styles.head}>
          <span className={styles.title}>{TITLES[current]}</span>
          <button
            type="button"
            className={styles.closeButton}
            onClick={close}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
        <div className={styles.body}>{renderContent(current)}</div>
      </div>
    </div>
  );
}
