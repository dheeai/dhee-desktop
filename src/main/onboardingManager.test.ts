import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FIRST_RUN_GUIDE_VERSION } from '../shared/onboardingTypes';

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
      guideVersion: FIRST_RUN_GUIDE_VERSION,
      completed: false,
      completedAt: null,
      skipped: false,
    });
    expect(mockStoreSet).toHaveBeenCalledWith('firstRunGuide', {
      guideVersion: FIRST_RUN_GUIDE_VERSION,
      completed: false,
      completedAt: null,
      skipped: false,
    });
  });

  it('persists guide completion', async () => {
    const onboarding = await loadOnboardingManager();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);

    expect(onboarding.completeOnboarding()).toEqual({
      guideVersion: FIRST_RUN_GUIDE_VERSION,
      completed: true,
      completedAt: 12345,
      skipped: false,
      completedReason: 'manual_finish',
    });
    expect(mockStoreData.firstRunGuide).toEqual({
      guideVersion: FIRST_RUN_GUIDE_VERSION,
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
      guideVersion: FIRST_RUN_GUIDE_VERSION,
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
      guideVersion: FIRST_RUN_GUIDE_VERSION,
      completed: true,
      completedAt: 24680,
      skipped: false,
      completedReason: 'first_prompt_submitted',
    });

    nowSpy.mockRestore();
  });

  it('re-shows the guide when a stored older guideVersion is bumped', async () => {
    // Simulate an existing user who completed the previous guide version.
    mockStoreData.firstRunGuide = {
      guideVersion: FIRST_RUN_GUIDE_VERSION - 1,
      completed: true,
      completedAt: 111,
      skipped: true,
      completedReason: 'skipped',
    };
    const onboarding = await loadOnboardingManager();

    const state = onboarding.getOnboardingState();
    // Version mismatch resets to defaults → quickstart shows again, once.
    expect(state.completed).toBe(false);
    expect(state.guideVersion).toBe(FIRST_RUN_GUIDE_VERSION);
    // …and the reset is persisted, so it won't re-show after this run.
    expect(mockStoreData.firstRunGuide).toMatchObject({
      guideVersion: FIRST_RUN_GUIDE_VERSION,
      completed: false,
    });
  });
});
