/**
 * Ambient types for the test bridge surface exposed inside the page.
 * Mirrors the runtime shape installed by `src/renderer/testing/installFakeBridge.ts`.
 */
interface KshanaTestRecordedCall {
  channel: string;
  args: unknown;
  at: number;
}

type KshanaTestSurface = 'chat' | 'landing' | 'workspace';

interface KshanaTestApi {
  loadScenario(scenario: unknown): void;
  loadScenarioByName(name: string): boolean;
  listScenarios(): string[];
  emit(eventName: string, data: unknown): void;
  emitElectron(channel: string, payload: unknown): void;
  getCalls(channel?: string): KshanaTestRecordedCall[];
  getProject(): { name: string | null; directory: string | null };
  getSurface(): KshanaTestSurface;
  setBridgeReturn(path: string, value: unknown): void;
  reset(): void;
}

interface FakeElectronProjectBridge {
  getRecent(): Promise<unknown[]>;
  addRecent(entry: unknown): Promise<void>;
  removeRecent(entry: unknown): Promise<void>;
  createFolder(parent: string, name: string): Promise<string>;
  deleteProject(path: string): Promise<void>;
  renameProject(oldPath: string, newName: string): Promise<string>;
  watchDirectory(path: string): Promise<void>;
  exportChatJson(payload: unknown): Promise<{ ok: boolean }>;
  selectDirectory(): Promise<string | null>;
  checkFileExists(path: string): Promise<boolean>;
  revealInFinder(path: string): Promise<void>;
}

interface FakeElectronBackendBridge {
  start(): Promise<{ status: string }>;
  restart(): Promise<{ status: string }>;
  stop(): Promise<{ status: string }>;
  getState(): Promise<{ status: string; serverUrl?: string; message?: string }>;
  getConnectionInfo(): Promise<unknown>;
  onStateChange(cb: (state: unknown) => void): () => void;
}

interface FakeElectronSettingsBridge {
  get(): Promise<unknown>;
  update(patch: unknown): Promise<unknown>;
  onChange(cb: (settings: unknown) => void): () => void;
}

interface FakeElectronAppBridge {
  getVersion(): Promise<string>;
}

interface FakeElectronBridge {
  project: FakeElectronProjectBridge;
  backend: FakeElectronBackendBridge;
  settings: FakeElectronSettingsBridge;
  app: FakeElectronAppBridge;
}

interface Window {
  __kshanaTest?: KshanaTestApi;
  electron: FakeElectronBridge;
}
