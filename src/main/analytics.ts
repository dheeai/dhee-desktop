import { randomUUID } from 'crypto';
import { app } from 'electron';
import Store from 'electron-store';
import type { AccountInfo } from '../shared/settingsTypes';
import type { dheeCoreManager } from './dheeCoreManager';

interface AnalyticsStore {
  installId?: string;
  firstDesktopStartCaptured?: boolean;
}

interface DesktopAnalyticsRuntime {
  manager: dheeCoreManager;
  account?: AccountInfo | null;
}

const HEARTBEAT_INTERVAL_MS = 60_000;

const analyticsStore = new Store<AnalyticsStore>({
  name: 'dhee-analytics',
  defaults: {},
  clearInvalidConfig: true,
});

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;
let activeInstallId: string | null = null;
let activeAnalyticsSessionId: string | null = null;

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

function getOrCreateAnalyticsSessionId(): string {
  if (activeAnalyticsSessionId) {
    return activeAnalyticsSessionId;
  }
  activeAnalyticsSessionId = randomUUID();
  return activeAnalyticsSessionId;
}

function sessionProperties(): Record<string, unknown> {
  const analyticsSessionId = getOrCreateAnalyticsSessionId();
  return {
    ...baseProperties(),
    analytics_session_id: analyticsSessionId,
    $session_id: analyticsSessionId,
  };
}

function configureIdentity({
  manager,
  account,
}: DesktopAnalyticsRuntime): string {
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
  activeAnalyticsSessionId = randomUUID();

  const firstCaptured =
    analyticsStore.get('firstDesktopStartCaptured') === true;
  if (!firstCaptured) {
    runtime.manager.captureAnalyticsEvent(
      'desktop_app_first_started',
      baseProperties(),
    );
    analyticsStore.set('firstDesktopStartCaptured', true);
  }

  runtime.manager.captureAnalyticsEvent('$screen', {
    ...sessionProperties(),
    $screen_name: 'desktop_main',
    screen_name: 'desktop_main',
  });

  runtime.manager.captureAnalyticsEvent('desktop_app_started', {
    ...sessionProperties(),
    launch_source: 'electron_main',
  });

  const captureHeartbeat = () => {
    runtime.manager.captureAnalyticsEvent('desktop_heartbeat', {
      ...sessionProperties(),
      heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
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

export function captureDesktopAuthStarted(manager: dheeCoreManager): void {
  manager.captureAnalyticsEvent('desktop_auth_started', {
    ...sessionProperties(),
    auth_surface: 'desktop_main',
  });
}

export function captureDesktopProjectCreated(
  manager: dheeCoreManager,
  input: { projectName: string },
): void {
  const projectName = input.projectName.trim();
  if (!projectName) {
    return;
  }

  manager.captureAnalyticsEvent('project_created', {
    ...sessionProperties(),
    project_name: projectName,
    project_name_length: projectName.length,
    creation_surface: 'new_project_dialog',
    project_creation_source: 'desktop',
  });
}

export function identifyDesktopUser(
  manager: dheeCoreManager,
  userId: string,
): void {
  const installId = activeInstallId ?? getOrCreateInstallId();
  manager.identifyAnalyticsUser({ installId, userId });
  manager.setAnalyticsIdentity({ installId, userId });
}

export function resetDesktopAnalyticsIdentity(manager: dheeCoreManager): void {
  const installId = activeInstallId ?? getOrCreateInstallId();
  manager.setAnalyticsIdentity({ installId });
}

let cloudUsageUnsub: (() => void) | null = null;
let cloudUsageUserId: string | null = null;

/**
 * Enable/disable per-user CLOUD LLM usage analytics to match the current
 * account + backend (issue #102). Forwards LLM token usage to PostHog
 * ONLY for cloud-billed accounts; for local / BYO-key accounts
 * (`cloudLlmBilled === false`) it tears any prior forwarder down so
 * nothing leaves the machine. Idempotent — it re-registers only when the
 * active user changes or activation flips — so it's safe to call on every
 * sign-in / sign-out / backend change. (dhee-core loads once and keeps
 * its listener registry across embedded restarts, so dedup-by-user is
 * correct here.)
 */
export function syncCloudUsageAnalytics(
  manager: dheeCoreManager,
  input: { cloudLlmBilled: boolean; userId?: string | null },
): void {
  const wantUserId = input.cloudLlmBilled && input.userId ? input.userId : null;
  if (wantUserId === cloudUsageUserId) {
    return;
  }
  if (cloudUsageUnsub) {
    try {
      cloudUsageUnsub();
    } catch {
      // unsubscribe must never throw upward
    }
    cloudUsageUnsub = null;
  }
  cloudUsageUserId = wantUserId;
  if (wantUserId) {
    const installId = activeInstallId ?? getOrCreateInstallId();
    cloudUsageUnsub = manager.enableCloudUsageAnalytics({
      userId: wantUserId,
      installId,
    });
  }
}

export function stopDesktopAnalytics(
  manager: dheeCoreManager,
  options: { flush?: boolean } = {},
): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  manager.captureAnalyticsEvent('desktop_app_quit', {
    ...sessionProperties(),
    uptime_ms: startedAt ? Math.max(0, Date.now() - startedAt) : undefined,
  });
  if (options.flush ?? true) {
    manager.flushAnalytics().catch(() => undefined);
  }
}
