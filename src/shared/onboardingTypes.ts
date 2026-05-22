export const FIRST_RUN_GUIDE_VERSION = 2;

export type OnboardingCompletionReason =
  | 'project_opened'
  | 'skipped'
  | 'manual_finish';

export interface OnboardingState {
  guideVersion: number;
  completed: boolean;
  completedAt: number | null;
  skipped: boolean;
  completedReason?: OnboardingCompletionReason;
}

export interface CompleteOnboardingRequest {
  skipped?: boolean;
  completedReason?: OnboardingCompletionReason;
}
