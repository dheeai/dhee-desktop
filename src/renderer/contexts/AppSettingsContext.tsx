import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AppSettings, ThemeId } from '../../shared/settingsTypes';
import { DEFAULT_THEME_ID } from '../themes';

interface AppSettingsContextValue {
  settings: AppSettings | null;
  themeId: ThemeId;
  isLoaded: boolean;
  isSavingConnection: boolean;
  error: string | null;
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  updateTheme: (themeId: ThemeId) => Promise<void>;
  saveConnectionSettings: (patch: Partial<AppSettings>) => Promise<boolean>;
  clearError: () => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function applyTheme(themeId: ThemeId) {
  document.documentElement.dataset.theme = themeId;
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    let active = true;

    const handleUpdate = (next: AppSettings) => {
      if (!active) {
        return;
      }
      setSettings(next);
      applyTheme(next.themeId);
      setIsLoaded(true);
    };

    window.electron.settings
      .get()
      .then(handleUpdate)
      .catch(() => {
        if (!active) {
          return;
        }
        applyTheme(DEFAULT_THEME_ID);
        setIsLoaded(true);
      });

    const unsubscribe = window.electron.settings.onChange(handleUpdate);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const updateTheme = useCallback(async (themeId: ThemeId) => {
    setError(null);
    applyTheme(themeId);
    setSettings((prev) => (prev ? { ...prev, themeId } : prev));

    try {
      const updated = await window.electron.settings.update({ themeId });
      setSettings(updated);
      applyTheme(updated.themeId);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Failed to update theme',
      );
      const restoredTheme = settings?.themeId ?? DEFAULT_THEME_ID;
      applyTheme(restoredTheme);
      setSettings((prev) =>
        prev ? { ...prev, themeId: restoredTheme } : prev,
      );
    }
  }, [settings?.themeId]);

  const saveConnectionSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      setIsSavingConnection(true);
      setError(null);

      try {
        const updated = await window.electron.settings.update(patch);
        setSettings(updated);
        applyTheme(updated.themeId);
        setIsSettingsOpen(false);
        return true;
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : 'Failed to save settings',
        );
        return false;
      } finally {
        setIsSavingConnection(false);
      }
    },
    [],
  );

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      settings,
      themeId: settings?.themeId ?? DEFAULT_THEME_ID,
      isLoaded,
      isSavingConnection,
      error,
      isSettingsOpen,
      openSettings: () => {
        setError(null);
        setIsSettingsOpen(true);
      },
      closeSettings: () => {
        setError(null);
        setIsSettingsOpen(false);
      },
      updateTheme,
      saveConnectionSettings,
      clearError: () => setError(null),
    }),
    [
      error,
      isLoaded,
      isSavingConnection,
      isSettingsOpen,
      saveConnectionSettings,
      settings,
      updateTheme,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error('useAppSettings must be used within AppSettingsProvider');
  }
  return context;
}
