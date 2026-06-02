/**
 * OverlayContext — central dispatcher for the binary workspace.
 *
 * The user-facing surfaces of the app are exactly three:
 *   1. Status strip (top)
 *   2. Inspector canvas (left)
 *   3. Chat (right)
 *
 * Everything else (Settings, Library, Plans, Timeline) opens as an
 * overlay over those three. Only one overlay can be open at a time
 * — opening a new one replaces the current. This keeps the workspace
 * mental model "one thing" instead of seven, per the 2026-05-28
 * architectural pivot.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type OverlayKey = 'settings' | 'library' | 'plans' | 'timeline';

export interface OverlayState {
  /** The currently open overlay, or null if none. */
  current: OverlayKey | null;
  /**
   * Per-open payload — the renderer for each overlay knows the shape
   * to expect (e.g. Library accepts `{ videoId }`, Plans accepts
   * `{ filePath }`). Typed loosely here because the dispatcher is
   * payload-agnostic.
   */
  payload: unknown;
  open: (key: OverlayKey, payload?: unknown) => void;
  close: () => void;
}

const OverlayContext = createContext<OverlayState | null>(null);

interface OverlayProviderProps {
  children: ReactNode;
}

export function OverlayProvider({ children }: OverlayProviderProps) {
  const [current, setCurrent] = useState<OverlayKey | null>(null);
  const [payload, setPayload] = useState<unknown>(null);

  const open = useCallback((key: OverlayKey, p?: unknown) => {
    setCurrent(key);
    setPayload(p ?? null);
  }, []);

  const close = useCallback(() => {
    setCurrent(null);
    setPayload(null);
  }, []);

  const value = useMemo<OverlayState>(
    () => ({ current, payload, open, close }),
    [current, payload, open, close],
  );

  return (
    <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
  );
}

export function useOverlay(): OverlayState {
  const ctx = useContext(OverlayContext);
  if (!ctx) {
    throw new Error('useOverlay must be used within an OverlayProvider');
  }
  return ctx;
}
