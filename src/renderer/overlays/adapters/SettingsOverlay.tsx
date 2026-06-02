/**
 * SettingsOverlay — adapter wrapping the existing SettingsPanel
 * inside the overlay frame. Consumes useAppSettings() so SettingsPanel
 * receives the props it expects (settings, updateTheme,
 * saveConnectionSettings, etc.) without OverlayHost knowing the
 * shape.
 */
import SettingsPanel from '../../components/SettingsPanel/SettingsPanel';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useOverlay } from '../OverlayContext';

export default function SettingsOverlay() {
  const { close } = useOverlay();
  const {
    settings,
    updateTheme,
    saveConnectionSettings,
    isSavingConnection,
    error: settingsError,
  } = useAppSettings();

  return (
    <SettingsPanel
      isOpen
      variant="embedded"
      settings={settings}
      onClose={close}
      onThemeChange={updateTheme}
      onSaveConnection={saveConnectionSettings}
      isSavingConnection={isSavingConnection}
      error={settingsError}
    />
  );
}
