import { EventEmitter } from 'events';
import log from 'electron-log';
import serverConnectionManager from './serverConnectionManager';
import localBackendManager from './localBackendManager';
import type {
  BackendConnectionInfo,
  BackendState,
  CloudBackendRuntimeConfig,
} from '../shared/backendTypes';
import type { AppSettings } from '../shared/settingsTypes';

function annotateState(state: BackendState, mode: AppSettings['backendMode']): BackendState {
  return {
    ...state,
    mode,
  };
}

function getCloudRuntimeIdentity(
  runtime?: CloudBackendRuntimeConfig,
): string | null {
  if (!runtime?.desktopToken || !runtime.proxyBaseUrl || !runtime.websiteUrl) {
    return null;
  }

  return JSON.stringify({
    desktopToken: runtime.desktopToken,
    proxyBaseUrl: runtime.proxyBaseUrl,
    websiteUrl: runtime.websiteUrl,
  });
}

class BackendManager extends EventEmitter {
  private state: BackendState = { status: 'idle', mode: 'local' };

  private selectedMode: AppSettings['backendMode'] = 'local';

  private activeCloudRuntimeIdentity: string | null = null;

  constructor() {
    super();

    localBackendManager.on('state', (state: BackendState) => {
      if (this.selectedMode !== state.mode) {
        return;
      }

      this.updateState(annotateState(state, this.selectedMode));
    });

    serverConnectionManager.on('state', (state: BackendState) => {
      if (this.selectedMode !== 'cloud') {
        return;
      }

      this.updateState(annotateState(state, 'cloud'));
    });
  }

  get status(): BackendState {
    return this.state;
  }

  private updateState(next: BackendState) {
    this.state = next;
    this.emit('state', this.state);
  }

  async start(
    settings: AppSettings,
    cloudRuntime?: CloudBackendRuntimeConfig,
  ): Promise<BackendState> {
    this.selectedMode = settings.backendMode;

    if (settings.backendMode === 'local') {
      await serverConnectionManager.disconnect();
      this.activeCloudRuntimeIdentity = null;
      const state =
        localBackendManager.status?.mode === 'cloud'
          ? await localBackendManager.restart(settings)
          : await localBackendManager.start(settings);
      const nextState = annotateState(state, 'local');
      this.updateState(nextState);
      return nextState;
    }

    await serverConnectionManager.disconnect();
    const nextCloudRuntimeIdentity = getCloudRuntimeIdentity(cloudRuntime);
    if (
      !cloudRuntime?.proxyBaseUrl ||
      !cloudRuntime.desktopToken ||
      !nextCloudRuntimeIdentity
    ) {
      this.activeCloudRuntimeIdentity = null;
      if (localBackendManager.status?.mode === 'cloud') {
        await localBackendManager.stop();
      }
      const nextState: BackendState = {
        status: 'error',
        mode: 'cloud',
        message: 'Kshana Cloud proxy URL and desktop token are required for cloud mode.',
      };
      this.updateState(nextState);
      return nextState;
    }

    const shouldRestartLocalBackend =
      localBackendManager.status?.mode === 'local' ||
      this.activeCloudRuntimeIdentity !== nextCloudRuntimeIdentity;

    if (shouldRestartLocalBackend) {
      this.activeCloudRuntimeIdentity = null;
    }

    const state = shouldRestartLocalBackend
      ? await localBackendManager.restart(settings, cloudRuntime)
      : await localBackendManager.start(settings, cloudRuntime);
    this.activeCloudRuntimeIdentity = nextCloudRuntimeIdentity;
    const nextState = annotateState(state, 'cloud');
    this.updateState(nextState);
    return nextState;
  }

  async restart(
    settings: AppSettings,
    cloudRuntime?: CloudBackendRuntimeConfig,
  ): Promise<BackendState> {
    if (settings.backendMode === 'local') {
      await serverConnectionManager.disconnect();
      this.selectedMode = 'local';
      this.activeCloudRuntimeIdentity = null;
      const state = await localBackendManager.restart(settings);
      const nextState = annotateState(state, 'local');
      this.updateState(nextState);
      return nextState;
    }

    this.selectedMode = 'cloud';
    await serverConnectionManager.disconnect();
    const nextCloudRuntimeIdentity = getCloudRuntimeIdentity(cloudRuntime);
    if (
      !cloudRuntime?.proxyBaseUrl ||
      !cloudRuntime.desktopToken ||
      !nextCloudRuntimeIdentity
    ) {
      this.activeCloudRuntimeIdentity = null;
      if (localBackendManager.status?.mode === 'cloud') {
        await localBackendManager.stop();
      }
      const nextState: BackendState = {
        status: 'error',
        mode: 'cloud',
        message: 'Kshana Cloud proxy URL and desktop token are required for cloud mode.',
      };
      this.updateState(nextState);
      return nextState;
    }

    this.activeCloudRuntimeIdentity = null;
    const state = await localBackendManager.restart(settings, cloudRuntime);
    this.activeCloudRuntimeIdentity = nextCloudRuntimeIdentity;
    const nextState = annotateState(state, 'cloud');
    this.updateState(nextState);
    return nextState;
  }

  async stop(): Promise<BackendState> {
    if (this.selectedMode === 'local' || this.selectedMode === 'cloud') {
      await serverConnectionManager.disconnect();
      this.activeCloudRuntimeIdentity = null;
      const state = await localBackendManager.stop();
      const nextState = annotateState(state, this.selectedMode);
      this.updateState(nextState);
      return nextState;
    }

    const state = await serverConnectionManager.disconnect();
    const nextState = annotateState(state, 'cloud');
    this.updateState(nextState);
    return nextState;
  }

  async getConnectionInfo(
    settings: AppSettings,
    cloudRuntime?: CloudBackendRuntimeConfig,
  ): Promise<BackendConnectionInfo> {
    const selectedMode = settings.backendMode;
    const bundledVersion = await localBackendManager.getBundledVersionInfo();
    const localServerUrl =
      localBackendManager.currentServerUrl || (
        selectedMode === 'local' || selectedMode === 'cloud' ? this.state.serverUrl : undefined
      );
    const effectiveServerUrl = selectedMode === 'cloud'
      ? localServerUrl || this.state.serverUrl
      : localServerUrl || this.state.serverUrl;
    const localBackendAvailable = await localBackendManager.isAvailable();

    return {
      selectedMode,
      effectiveServerUrl,
      cloudServerUrl: cloudRuntime?.websiteUrl,
      cloudWebsiteUrl: cloudRuntime?.websiteUrl,
      proxyBaseUrl: cloudRuntime?.proxyBaseUrl,
      legacyCoreUrl: cloudRuntime?.legacyCoreUrl,
      localServerUrl,
      localBackendAvailable,
      bundledVersion,
      note:
        selectedMode === 'cloud'
          ? 'Kshana Cloud credits run through the authenticated proxy while the bundled core runs locally.'
          : undefined,
    };
  }
}

const backendManager = new BackendManager();

backendManager.on('error', (error) => {
  log.error('[BackendManager] Unhandled error event', error);
});

export default backendManager;
