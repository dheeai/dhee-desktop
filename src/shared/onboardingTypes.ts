export const FIRST_RUN_GUIDE_VERSION = 3;

export type OnboardingCompletionReason =
  | 'project_opened'
  | 'first_prompt_submitted'
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
