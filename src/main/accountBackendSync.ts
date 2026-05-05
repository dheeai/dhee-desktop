import type { AccountInfo, AppSettings } from '../shared/settingsTypes';

export function shouldRestartCloudBackendForAccountChange(
  settings: AppSettings,
  previousAccount: AccountInfo | null,
  nextToken: string,
): boolean {
  return settings.backendMode === 'cloud' && previousAccount?.token !== nextToken;
}

export function shouldStopCloudBackendOnSignOut(settings: AppSettings): boolean {
  return settings.backendMode === 'cloud';
}
