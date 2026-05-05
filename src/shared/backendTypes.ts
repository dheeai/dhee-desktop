import type { BackendMode } from './settingsTypes';

export type BackendStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  // Keep legacy aliases so existing renderer code still compiles
  | 'starting'
  | 'ready'
  | 'stopped';

export interface BackendState {
  status: BackendStatus;
  message?: string;
  port?: number;
  serverUrl?: string;
  mode?: BackendMode;
}

/**
 * Configuration for connecting to an external kshana-core server.
 * All LLM / provider config now lives on the server side.
 */
export interface ServerConnectionConfig {
  /** Full base URL of the kshana-core server, e.g. "http://localhost:8001" */
  serverUrl: string;
  /** Automatically reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
}

export interface CloudBackendRuntimeConfig {
  /** Kshana website origin used for auth, billing, and account APIs. */
  websiteUrl: string;
  /** Authenticated proxy origin for paid upstream APIs. */
  proxyBaseUrl: string;
  /** Signed desktop JWT issued by the website. */
  desktopToken?: string;
  /** Legacy hosted kshana-core URL retained for dev/fallback metadata only. */
  legacyCoreUrl?: string;
}

export interface BundledVersionInfo {
  packageVersion?: string;
  gitBranch?: string;
  gitCommit?: string;
  commitDate?: string;
}

export interface BackendConnectionInfo {
  selectedMode: BackendMode;
  effectiveServerUrl?: string;
  cloudServerUrl?: string;
  cloudWebsiteUrl?: string;
  proxyBaseUrl?: string;
  legacyCoreUrl?: string;
  localServerUrl?: string;
  localBackendAvailable: boolean;
  bundledVersion?: BundledVersionInfo;
  note?: string;
}
