import { randomUUID } from 'crypto';
import { app } from 'electron';
import Store from 'electron-store';
import type { AccountInfo } from '../shared/settingsTypes';
import type { KshanaCoreManager } from './kshanaCoreManager';

interface AnalyticsStore {
  installId?: string;
  firstDesktopStartCaptured?: boolean;
}

interface DesktopAnalyticsRuntime {
  manager: KshanaCoreManager;
  account?: AccountInfo | null;
}

const HEARTBEAT_INTERVAL_MS = 60_000;

const analyticsStore = new Store<AnalyticsStore>({
  name: 'kshana-analytics',
  defaults: {},
  clearInvalidConfig: true,
});

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;
let activeInstallId: string | null = null;

export function getOrCreateInstallId(): string {
  const existing = analyticsStore.get('installId');
  if (existing && typeof existing === 'string') {
    activeInstallId = existing;
    return existing;
  }

  const created = randomUUID();
  analyticsStore.set('installId', created);
  activeInstallId = created;
  return created;
}

function platformName(): string {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  return process.platform;
}

function baseProperties(): Record<string, unknown> {
  return {
    app_version: app.getVersion(),
    app_packaged: app.isPackaged,
    platform: platformName(),
    arch: process.arch,
    electron_version: process.versions.electron,
    node_version: process.versions.node,
  };
}

function configureIdentity({ manager, account }: DesktopAnalyticsRuntime): string {
  const installId = getOrCreateInstallId();
  manager.configureAnalytics({
    appVersion: app.getVersion(),
    installId,
    ...(account?.userId ? { userId: account.userId } : {}),
    properties: baseProperties(),
  });
  return installId;
}

export function startDesktopAnalytics(runtime: DesktopAnalyticsRuntime): void {
  const installId = configureIdentity(runtime);
  startedAt = Date.now();

  const firstCaptured = analyticsStore.get('firstDesktopStartCaptured') === true;
  if (!firstCaptured) {
    runtime.manager.captureAnalyticsEvent('desktop_app_first_started', baseProperties());
    analyticsStore.set('firstDesktopStartCaptured', true);
  }

  runtime.manager.captureAnalyticsEvent('desktop_app_started', {
    ...baseProperties(),
    launch_source: 'electron_main',
  });

  const captureHeartbeat = () => {
    runtime.manager.captureAnalyticsEvent('desktop_heartbeat', {
      ...baseProperties(),
      uptime_ms: Math.max(0, Date.now() - startedAt),
    });
  };

  captureHeartbeat();

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  heartbeatInterval = setInterval(captureHeartbeat, HEARTBEAT_INTERVAL_MS);
  activeInstallId = installId;
}

export function captureDesktopAuthStarted(manager: KshanaCoreManager): void {
  manager.captureAnalyticsEvent('desktop_auth_started', {
    ...baseProperties(),
    auth_surface: 'desktop_main',
  });
}

export function identifyDesktopUser(
  manager: KshanaCoreManager,
  userId: string,
): void {
  const installId = activeInstallId ?? getOrCreateInstallId();
  manager.identifyAnalyticsUser({ installId, userId });
  manager.setAnalyticsIdentity({ installId, userId });
}

export function resetDesktopAnalyticsIdentity(manager: KshanaCoreManager): void {
  const installId = activeInstallId ?? getOrCreateInstallId();
  manager.setAnalyticsIdentity({ installId });
}

export function stopDesktopAnalytics(manager: KshanaCoreManager): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  manager.captureAnalyticsEvent('desktop_app_quit', {
    ...baseProperties(),
    uptime_ms: startedAt ? Math.max(0, Date.now() - startedAt) : undefined,
  });
  void manager.flushAnalytics();
}
