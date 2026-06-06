// Bump this when the first-run quickstart changes enough that existing
// users should see it again. normalizeOnboardingState() resets `completed`
// to false whenever a stored guideVersion differs from this — so a bump
// re-shows the quickstart ONCE for everyone on the next version, then it
// stores the new version and stays hidden.
//
// v3 → v4 (release with the LLM "Test connection" + OpenAI-compatible
// relabel): re-show the quickstart once for existing users on update.
// Fresh installs from here on rely on the NSIS uninstall reset instead;
// keep this stable across future releases unless the quickstart changes.
export const FIRST_RUN_GUIDE_VERSION = 4;

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
