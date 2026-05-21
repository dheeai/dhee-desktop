import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { dheeCoreManager } from './dheeCoreManager';
import type { AccountInfo } from '../shared/settingsTypes';

const mockStoreData: Record<string, unknown> = {};
const mockStoreGet = jest.fn((key: string) => mockStoreData[key]);
const mockStoreSet = jest.fn((key: string, value: unknown) => {
  mockStoreData[key] = value;
});

jest.mock('electron', () => ({
  app: {
    getVersion: jest.fn(() => '9.9.9'),
    isPackaged: true,
  },
}));

jest.mock('electron-store', () =>
  jest.fn().mockImplementation(() => ({
    get: mockStoreGet,
    set: mockStoreSet,
  })),
);

type ManagerMock = {
  captureAnalyticsEvent: jest.Mock;
  configureAnalytics: jest.Mock;
  flushAnalytics: jest.Mock;
  identifyAnalyticsUser: jest.Mock;
  setAnalyticsIdentity: jest.Mock;
};

function createManager(): ManagerMock {
  return {
    captureAnalyticsEvent: jest.fn(),
    configureAnalytics: jest.fn(),
    flushAnalytics: jest.fn(async () => undefined),
    identifyAnalyticsUser: jest.fn(),
    setAnalyticsIdentity: jest.fn(),
  };
}

function createAccount(userId: string): AccountInfo {
  return {
    userId,
    email: `${userId}@example.test`,
    credits: 0,
    token: `token-${userId}`,
  };
}

async function loadAnalytics() {
  return import('./analytics.js');
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  Object.keys(mockStoreData).forEach((key) => delete mockStoreData[key]);
  mockStoreGet.mockClear();
  mockStoreSet.mockClear();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('desktop analytics', () => {
  it('persists one install id and captures first launch only once', async () => {
    const analytics = await loadAnalytics();
    const manager = createManager();

    analytics.startDesktopAnalytics({
      manager: manager as unknown as dheeCoreManager,
    });
    const { installId } = mockStoreData;

    analytics.startDesktopAnalytics({
      manager: manager as unknown as dheeCoreManager,
    });
    analytics.stopDesktopAnalytics(manager as unknown as dheeCoreManager);

    expect(installId).toEqual(expect.any(String));
    expect(mockStoreData.firstDesktopStartCaptured).toBe(true);
    expect(manager.configureAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        appVersion: '9.9.9',
        installId,
        properties: expect.objectContaining({
          app_version: '9.9.9',
          app_packaged: true,
          arch: process.arch,
        }),
      }),
    );

    const events = manager.captureAnalyticsEvent.mock.calls.map(
      ([event]) => event,
    );
    expect(
      events.filter((event) => event === 'desktop_app_first_started'),
    ).toHaveLength(1);
    expect(events.filter((event) => event === '$screen')).toHaveLength(2);
    expect(
      events.filter((event) => event === 'desktop_app_started'),
    ).toHaveLength(2);
    expect(
      events.filter((event) => event === 'desktop_heartbeat'),
    ).toHaveLength(2);
    expect(events).toContain('desktop_app_quit');

    const screenCall = manager.captureAnalyticsEvent.mock.calls.find(
      ([event]) => event === '$screen',
    );
    expect(screenCall?.[1]).toEqual(
      expect.objectContaining({
        $screen_name: 'desktop_main',
        $session_id: expect.any(String),
        analytics_session_id: expect.any(String),
      }),
    );

    const startCall = manager.captureAnalyticsEvent.mock.calls.find(
      ([event]) => event === 'desktop_app_started',
    );
    expect(startCall?.[1]).toEqual(
      expect.objectContaining({
        $session_id: expect.any(String),
        analytics_session_id: expect.any(String),
        launch_source: 'electron_main',
      }),
    );

    const heartbeatCall = manager.captureAnalyticsEvent.mock.calls.find(
      ([event]) => event === 'desktop_heartbeat',
    );
    expect(heartbeatCall?.[1]).toEqual(
      expect.objectContaining({
        $session_id: expect.any(String),
        heartbeat_interval_ms: 60_000,
      }),
    );
    expect(manager.flushAnalytics).toHaveBeenCalledTimes(1);
  });

  it('configures signed-in identity and merges install identity after auth', async () => {
    mockStoreData.installId = 'install-stable';
    mockStoreData.firstDesktopStartCaptured = true;
    const analytics = await loadAnalytics();
    const manager = createManager();

    analytics.startDesktopAnalytics({
      manager: manager as unknown as dheeCoreManager,
      account: createAccount('user-1'),
    });
    analytics.identifyDesktopUser(
      manager as unknown as dheeCoreManager,
      'user-2',
    );
    analytics.resetDesktopAnalyticsIdentity(
      manager as unknown as dheeCoreManager,
    );
    analytics.captureDesktopAuthStarted(manager as unknown as dheeCoreManager);
    analytics.stopDesktopAnalytics(manager as unknown as dheeCoreManager);

    expect(manager.configureAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        installId: 'install-stable',
        userId: 'user-1',
      }),
    );
    expect(manager.identifyAnalyticsUser).toHaveBeenCalledWith({
      installId: 'install-stable',
      userId: 'user-2',
    });
    expect(manager.setAnalyticsIdentity).toHaveBeenCalledWith({
      installId: 'install-stable',
      userId: 'user-2',
    });
    expect(manager.setAnalyticsIdentity).toHaveBeenLastCalledWith({
      installId: 'install-stable',
    });
    expect(manager.captureAnalyticsEvent).toHaveBeenCalledWith(
      'desktop_auth_started',
      expect.objectContaining({
        $session_id: expect.any(String),
        auth_surface: 'desktop_main',
        app_version: '9.9.9',
      }),
    );
  });

  it('can defer the final flush until core shutdown has queued session-ended events', async () => {
    mockStoreData.installId = 'install-stable';
    mockStoreData.firstDesktopStartCaptured = true;
    const analytics = await loadAnalytics();
    const manager = createManager();

    analytics.startDesktopAnalytics({
      manager: manager as unknown as dheeCoreManager,
    });
    analytics.stopDesktopAnalytics(manager as unknown as dheeCoreManager, {
      flush: false,
    });

    expect(manager.captureAnalyticsEvent).toHaveBeenCalledWith(
      'desktop_app_quit',
      expect.objectContaining({
        $session_id: expect.any(String),
      }),
    );
    expect(manager.flushAnalytics).not.toHaveBeenCalled();
  });
});
