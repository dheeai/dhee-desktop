/* eslint-disable compat/compat */
import type { BackendState } from '../../shared/backendTypes';
import type { AppSettings } from '../../shared/settingsTypes';

function normalizeUrl(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function isLikelyCloudUrl(serverUrl?: string): boolean {
  if (!serverUrl) {
    return false;
  }

  try {
    const { hostname, protocol } = new URL(serverUrl);
    return (
      protocol === 'https:' ||
      (hostname !== 'localhost' &&
        hostname !== '127.0.0.1' &&
        hostname !== '::1')
    );
  } catch {
    return false;
  }
}

export function shouldRestartForSettings(
  backendState: BackendState,
  settings: AppSettings | null,
): boolean {
  if (!settings?.backendMode) {
    return false;
  }

  if (backendState.mode && backendState.mode !== settings.backendMode) {
    return true;
  }

  if (settings.backendMode === 'cloud') {
    return false;
  }

  return (
    settings.backendMode === 'local' && isLikelyCloudUrl(backendState.serverUrl)
  );
}

export async function getBackendStateForSettings(
  settings: AppSettings | null,
): Promise<BackendState> {
  const backendState = await window.electron.backend.getState();

  if (!shouldRestartForSettings(backendState, settings)) {
    return backendState;
  }

  const restartedState = await window.electron.backend.restart();
  return restartedState;
}

export async function getBackendBaseUrlForSettings(
  settings: AppSettings | null,
  backendState: BackendState,
): Promise<string> {
  if (settings?.backendMode === 'cloud') {
    const connectionInfo = await window.electron.backend
      .getConnectionInfo()
      .catch(() => null);
    const cloudUrl = normalizeUrl(
      connectionInfo?.effectiveServerUrl || backendState.serverUrl,
    );
    if (cloudUrl) {
      return cloudUrl;
    }
  }

  return (
    backendState.serverUrl || `http://localhost:${backendState.port ?? 8001}`
  );
}
