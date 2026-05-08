import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { KshanaCoreManager } from './kshanaCoreManager';
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
  return import('./analytics');
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
      manager: manager as unknown as KshanaCoreManager,
    });
    const installId = mockStoreData.installId;

    analytics.startDesktopAnalytics({
      manager: manager as unknown as KshanaCoreManager,
    });
    analytics.stopDesktopAnalytics(manager as unknown as KshanaCoreManager);

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
    expect(events.filter((event) => event === 'desktop_app_first_started')).toHaveLength(1);
    expect(events.filter((event) => event === 'desktop_app_started')).toHaveLength(2);
    expect(events.filter((event) => event === 'desktop_heartbeat')).toHaveLength(2);
    expect(events).toContain('desktop_app_quit');
    expect(manager.flushAnalytics).toHaveBeenCalledTimes(1);
  });

  it('configures signed-in identity and merges install identity after auth', async () => {
    mockStoreData.installId = 'install-stable';
    mockStoreData.firstDesktopStartCaptured = true;
    const analytics = await loadAnalytics();
    const manager = createManager();

    analytics.startDesktopAnalytics({
      manager: manager as unknown as KshanaCoreManager,
      account: createAccount('user-1'),
    });
    analytics.identifyDesktopUser(
      manager as unknown as KshanaCoreManager,
      'user-2',
    );
    analytics.resetDesktopAnalyticsIdentity(
      manager as unknown as KshanaCoreManager,
    );
    analytics.captureDesktopAuthStarted(
      manager as unknown as KshanaCoreManager,
    );
    analytics.stopDesktopAnalytics(manager as unknown as KshanaCoreManager);

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
        auth_surface: 'desktop_main',
        app_version: '9.9.9',
      }),
    );
  });
});
