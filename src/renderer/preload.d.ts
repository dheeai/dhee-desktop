import { ElectronHandler, KshanaBridge } from '../main/preload';

type DesktopElectronHandler = ElectronHandler & {
  app: {
    getVersion(): Promise<string>;
  };
};

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: DesktopElectronHandler;
    /**
     * Typed bridge to the embedded kshana-ink (replaces the old
     * WebSocket transport). Methods invoke ipcMain handlers in the
     * Electron main process; `on()` subscribes to streaming events.
     */
    kshana: KshanaBridge;
  }
}

export {};
