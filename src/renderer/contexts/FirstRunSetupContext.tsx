/**
 * FirstRunSetupContext — gates the full-screen first-run Setup flow.
 * Active on a fresh install (onboarding not completed) until the user
 * finishes or skips, at which point onboarding is marked complete (which
 * also stops the legacy coachmark tour from auto-starting). Re-openable
 * from Settings via open().
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface FirstRunSetupValue {
  /** True while the full-screen setup flow should be shown. */
  isActive: boolean;
  /** Whether the initial onboarding-state probe has resolved. */
  ready: boolean;
  /** Re-open the flow (e.g. from Settings → "Re-run setup"). */
  open: () => void;
  /** Finish (or skip) the flow and persist completion. */
  complete: (reason?: 'manual_finish' | 'skipped') => Promise<void>;
}

// Default is a safe no-op so components rendered outside the provider
// (e.g. isolated tests of SettingsPanel) don't throw — open() just does
// nothing there.
const FirstRunSetupContext = createContext<FirstRunSetupValue>({
  isActive: false,
  ready: false,
  open: () => undefined,
  complete: async () => undefined,
});

export function FirstRunSetupProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electron.onboarding
      .getState()
      .then((state) => {
        if (cancelled) return;
        setIsActive(state?.completed === false);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<FirstRunSetupValue>(
    () => ({
      isActive,
      ready,
      open: () => setIsActive(true),
      complete: async (reason = 'manual_finish') => {
        setIsActive(false);
        try {
          await window.electron.onboarding.complete({
            skipped: reason === 'skipped',
            completedReason: reason,
          });
        } catch {
          /* completion is best-effort; the UI already closed */
        }
      },
    }),
    [isActive, ready],
  );

  return <FirstRunSetupContext.Provider value={value}>{children}</FirstRunSetupContext.Provider>;
}

export function useFirstRunSetup(): FirstRunSetupValue {
  return useContext(FirstRunSetupContext);
}
