import Store from 'electron-store';
import {
  FIRST_RUN_GUIDE_VERSION,
  type CompleteOnboardingRequest,
  type OnboardingState,
} from '../shared/onboardingTypes';

interface OnboardingStore {
  firstRunGuide: OnboardingState;
}

const defaultState: OnboardingState = {
  guideVersion: FIRST_RUN_GUIDE_VERSION,
  completed: false,
  completedAt: null,
  skipped: false,
};

const onboardingStore = new Store<OnboardingStore>({
  name: 'dhee-onboarding',
  defaults: {
    firstRunGuide: defaultState,
  },
});

function normalizeOnboardingState(value: unknown): OnboardingState {
  const state = (value ?? {}) as Partial<OnboardingState>;
  if (state.guideVersion !== FIRST_RUN_GUIDE_VERSION) {
    return { ...defaultState };
  }

  return {
    guideVersion: FIRST_RUN_GUIDE_VERSION,
    completed: state.completed === true,
    completedAt:
      typeof state.completedAt === 'number' &&
      Number.isFinite(state.completedAt)
        ? state.completedAt
        : null,
    skipped: state.skipped === true,
    completedReason: state.completedReason,
  };
}

export function getOnboardingState(): OnboardingState {
  const normalized = normalizeOnboardingState(
    onboardingStore.get('firstRunGuide', defaultState),
  );
  onboardingStore.set('firstRunGuide', normalized);
  return normalized;
}

export function completeOnboarding(
  req: CompleteOnboardingRequest = {},
): OnboardingState {
  const next: OnboardingState = {
    guideVersion: FIRST_RUN_GUIDE_VERSION,
    completed: true,
    completedAt: Date.now(),
    skipped: req.skipped === true,
    completedReason:
      req.completedReason ||
      (req.skipped === true ? 'skipped' : 'manual_finish'),
  };
  onboardingStore.set('firstRunGuide', next);
  return next;
}

export { normalizeOnboardingState };
