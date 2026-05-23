import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStoreData: Record<string, unknown> = {};
const mockStoreGet = jest.fn((key: string, fallback?: unknown) =>
  key in mockStoreData ? mockStoreData[key] : fallback,
);
const mockStoreSet = jest.fn((key: string, value: unknown) => {
  mockStoreData[key] = value;
});

jest.mock('electron-store', () =>
  jest.fn().mockImplementation(() => ({
    get: mockStoreGet,
    set: mockStoreSet,
  })),
);

async function loadOnboardingManager() {
  return import('./onboardingManager.js');
}

beforeEach(() => {
  jest.resetModules();
  Object.keys(mockStoreData).forEach((key) => delete mockStoreData[key]);
  mockStoreGet.mockClear();
  mockStoreSet.mockClear();
});

describe('onboardingManager', () => {
  it('returns and persists the default first-run guide state', async () => {
    const onboarding = await loadOnboardingManager();

    expect(onboarding.getOnboardingState()).toEqual({
      guideVersion: 3,
      completed: false,
      completedAt: null,
      skipped: false,
    });
    expect(mockStoreSet).toHaveBeenCalledWith('firstRunGuide', {
      guideVersion: 3,
      completed: false,
      completedAt: null,
      skipped: false,
    });
  });

  it('persists guide completion', async () => {
    const onboarding = await loadOnboardingManager();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);

    expect(onboarding.completeOnboarding()).toEqual({
      guideVersion: 3,
      completed: true,
      completedAt: 12345,
      skipped: false,
      completedReason: 'manual_finish',
    });
    expect(mockStoreData.firstRunGuide).toEqual({
      guideVersion: 3,
      completed: true,
      completedAt: 12345,
      skipped: false,
      completedReason: 'manual_finish',
    });

    nowSpy.mockRestore();
  });

  it('persists explicit skip state', async () => {
    const onboarding = await loadOnboardingManager();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(67890);

    expect(onboarding.completeOnboarding({ skipped: true })).toEqual({
      guideVersion: 3,
      completed: true,
      completedAt: 67890,
      skipped: true,
      completedReason: 'skipped',
    });

    nowSpy.mockRestore();
  });

  it('persists project-open completion reason', async () => {
    const onboarding = await loadOnboardingManager();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(24680);

    expect(
      onboarding.completeOnboarding({
        completedReason: 'first_prompt_submitted',
      }),
    ).toEqual({
      guideVersion: 3,
      completed: true,
      completedAt: 24680,
      skipped: false,
      completedReason: 'first_prompt_submitted',
    });

    nowSpy.mockRestore();
  });
});
