import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useWorkspace } from './WorkspaceContext';
import {
  FIRST_RUN_GUIDE_VERSION,
  type CompleteOnboardingRequest,
  type OnboardingState,
} from '../../shared/onboardingTypes';
import styles from './FirstRunTourContext.module.scss';

type TourSource = 'auto' | 'help';
export type FirstRunTourEvent =
  | 'provider_choice_seen'
  | 'settings_local_setup_seen'
  | 'settings_cloud_setup_seen'
  | 'new_project_clicked'
  | 'project_name_valid'
  | 'project_location_seen'
  | 'project_location_confirmed'
  | 'project_opened'
  | 'chat_visible'
  | 'setup_wizard_visible'
  | 'setup_style_selected'
  | 'setup_duration_selected'
  | 'setup_story_valid'
  | 'setup_story_submitted'
  | 'chat_prompt_valid'
  | 'chat_prompt_sent';

export const FIRST_RUN_TOUR_LANDING_ACTION_EVENT =
  'dhee:first-run-tour:landing-action';

export type FirstRunTourLandingAction =
  | { action: 'open-settings'; tab: 'connection' }
  | { action: 'show-projects' };

interface StartTourRequest {
  source: TourSource;
}

interface FirstRunTourContextValue {
  isActive: boolean;
  startTour: (req: StartTourRequest) => void;
  skipTour: () => void;
  notifyTourEvent: (event: FirstRunTourEvent) => void;
}

type TourStepId =
  | 'landing-provider-choice'
  | 'settings-local-comfy'
  | 'settings-local-llm-provider'
  | 'settings-local-llm-key'
  | 'settings-local-llm-model'
  | 'settings-local-test'
  | 'settings-local-save'
  | 'settings-cloud-signin'
  | 'settings-cloud-toggles'
  | 'landing-create'
  | 'project-name'
  | 'project-location'
  | 'project-create'
  | 'workspace-chat'
  | 'setup-style'
  | 'setup-duration'
  | 'setup-story'
  | 'setup-submit'
  | 'chat-prompt'
  | 'workspace-preview';

interface TourStep {
  id: TourStepId;
  title: string;
  body: string;
  targetId?: string;
  fallbackTargetIds?: string[];
  actionHint?: string;
  requiresAction?: boolean;
  actionKind?: 'provider-choice' | 'settings-setup' | 'project-location';
}

interface TargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const FirstRunTourContext = createContext<FirstRunTourContextValue | null>(
  null,
);

const fallbackState: OnboardingState = {
  guideVersion: FIRST_RUN_GUIDE_VERSION,
  completed: false,
  completedAt: null,
  skipped: false,
};

const TOUR_STEPS: TourStep[] = [
  {
    id: 'landing-provider-choice',
    targetId: 'landing-provider-status',
    fallbackTargetIds: ['landing-sign-in'],
    title: 'Choose how Dhee runs',
    body: 'Dhee can use Dhee Cloud credits or local providers. You can inspect either setup path now, but you can also continue without entering keys.',
    actionHint:
      'Setup is optional during the walkthrough. The project flow stays available.',
    actionKind: 'provider-choice',
  },
  {
    id: 'settings-local-comfy',
    targetId: 'settings-comfy-url',
    title: 'Local ComfyUI lives here',
    body: 'For local image and video generation, enter the ComfyUI server URL here. The default is fine to leave blank until you have a local server ready.',
    actionHint: 'You can continue without filling this in.',
    actionKind: 'settings-setup',
  },
  {
    id: 'settings-local-llm-provider',
    targetId: 'settings-llm-provider',
    title: 'Choose the local LLM provider',
    body: 'Dhee uses an LLM for planning, story structure, prompts, and agent decisions. Pick Gemini or an OpenAI-compatible endpoint when you are ready.',
    actionHint: 'This is informational for first run.',
    actionKind: 'settings-setup',
  },
  {
    id: 'settings-local-llm-key',
    targetId: 'settings-llm-api-key',
    fallbackTargetIds: ['settings-llm-provider'],
    title: 'API keys go in the provider section',
    body: 'Put your Gemini or OpenAI-compatible key here. Dhee does not require you to enter it before creating a project.',
    actionHint: 'No key is required to continue the guide.',
    actionKind: 'settings-setup',
  },
  {
    id: 'settings-local-llm-model',
    targetId: 'settings-llm-model',
    fallbackTargetIds: ['settings-llm-provider'],
    title: 'Model IDs are configured beside the key',
    body: 'This field tells Dhee which model to call for the main creative work. You can come back and tune this later.',
    actionHint: 'Leave the default until you know which model you want.',
    actionKind: 'settings-setup',
  },
  {
    id: 'settings-local-test',
    targetId: 'settings-provider-test',
    title: 'Test providers when ready',
    body: 'This check probes Cloud, ComfyUI, and LLM readiness. It is advisory and will not block the guide.',
    actionHint: 'Use it after entering settings, or skip it for now.',
    actionKind: 'settings-setup',
  },
  {
    id: 'settings-local-save',
    targetId: 'settings-save-connection',
    title: 'Save connection changes',
    body: 'When you do edit provider fields, save them here. For the walkthrough you can continue without saving anything.',
    actionHint: 'Continue returns to project creation.',
    actionKind: 'settings-setup',
  },
  {
    id: 'settings-cloud-signin',
    targetId: 'settings-cloud-sign-in',
    fallbackTargetIds: ['settings-cloud-toggles'],
    title: 'Cloud sign-in starts here',
    body: 'Dhee Cloud uses the browser sign-in flow. If you started sign-in, finish it in the browser, then return here.',
    actionHint: 'Sign-in is external, so the guide stays non-blocking.',
    actionKind: 'settings-setup',
  },
  {
    id: 'settings-cloud-toggles',
    targetId: 'settings-cloud-toggles',
    fallbackTargetIds: ['settings-cloud-sign-in'],
    title: 'Cloud mode toggles live in Connection',
    body: 'After sign-in, these switches route ComfyUI, LLM, or VLM work through Dhee Cloud credits instead of local providers.',
    actionHint: 'You can continue without enabling Cloud mode.',
    actionKind: 'settings-setup',
  },
  {
    id: 'landing-create',
    targetId: 'landing-new-project',
    title: 'Create your first project',
    body: 'Start with a project. If you already have one on disk, Open Workspace works too.',
    actionHint: 'Click New Project to continue.',
    requiresAction: true,
  },
  {
    id: 'project-name',
    targetId: 'new-project-name',
    title: 'Name the project',
    body: 'Give this workspace a clear name. After that, the guide will show where the project folder is created.',
    actionHint: 'Type a project name to continue to location.',
    requiresAction: true,
  },
  {
    id: 'project-location',
    targetId: 'new-project-location',
    fallbackTargetIds: ['new-project-choose-folder'],
    title: 'Confirm the project location',
    body: 'Dhee creates a folder for this project inside the location shown here. The default is okay, or you can choose another parent folder.',
    actionHint: 'Use the current location or choose a folder.',
    requiresAction: true,
    actionKind: 'project-location',
  },
  {
    id: 'project-create',
    targetId: 'new-project-create',
    fallbackTargetIds: ['new-project-name'],
    title: 'Create the project folder',
    body: 'Keep or change the location, then create the project. Dhee opens the workspace as soon as the folder is ready.',
    actionHint: 'Click Create Project to continue.',
    requiresAction: true,
  },
  {
    id: 'workspace-chat',
    targetId: 'workspace-chat-panel',
    title: 'Chat drives the workflow',
    body: 'This is where you describe the video, ask for edits, inspect progress, and continue generation. Fresh projects usually start with the setup wizard in this chat panel.',
  },
  {
    id: 'setup-style',
    targetId: 'setup-style-options',
    fallbackTargetIds: ['workspace-setup-wizard'],
    title: 'Pick a visual style',
    body: 'Choose the style that best matches the video you want. This gives the agent a strong creative direction.',
    actionHint: 'Select a style to continue.',
    requiresAction: true,
  },
  {
    id: 'setup-duration',
    targetId: 'setup-duration-options',
    fallbackTargetIds: ['workspace-setup-wizard'],
    title: 'Choose the duration',
    body: 'Duration controls how much structure Dhee plans before generation starts.',
    actionHint: 'Select a duration to continue.',
    requiresAction: true,
  },
  {
    id: 'setup-story',
    targetId: 'setup-story-input',
    fallbackTargetIds: ['workspace-setup-wizard'],
    title: 'Enter the first prompt',
    body: 'This is the most important onboarding step. Describe the story, product, scene, or video idea you want Dhee to build.',
    actionHint: 'Type a story or prompt to continue.',
    requiresAction: true,
  },
  {
    id: 'setup-submit',
    targetId: 'setup-story-continue',
    fallbackTargetIds: ['setup-story-input'],
    title: 'Send the setup prompt',
    body: 'This submits your first creative prompt and starts the project setup work in chat.',
    actionHint: 'Click Continue to start.',
    requiresAction: true,
  },
  {
    id: 'chat-prompt',
    targetId: 'workspace-chat-input',
    title: 'Type the first chat prompt',
    body: 'If the setup wizard is not shown, type the first request here. You can ask for a storyboard, a video concept, or a specific edit.',
    actionHint: 'Type a prompt and press Enter or Send.',
    requiresAction: true,
  },
  {
    id: 'workspace-preview',
    targetId: 'workspace-preview',
    title: 'Outputs appear in the preview area',
    body: 'Generated images, videos, timelines, and export tools appear here after the agent starts producing assets. Keep chat open for targeted changes.',
  },
];

function getTourStepIndex(id: TourStepId): number {
  const index = TOUR_STEPS.findIndex((step) => step.id === id);
  return index >= 0 ? index : 0;
}

function isTourDevModeEnabled() {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.dhee_FIRST_RUN_TOUR_DEV_MODE === '1'
  );
}

function getOnboardingBridge() {
  return (
    window.electron as typeof window.electron & {
      onboarding?: typeof window.electron.onboarding;
    }
  ).onboarding;
}

function requestLandingAction(detail: FirstRunTourLandingAction) {
  window.dispatchEvent(
    new CustomEvent<FirstRunTourLandingAction>(
      FIRST_RUN_TOUR_LANDING_ACTION_EVENT,
      { detail },
    ),
  );
}

function getTargetElement(step: TourStep): HTMLElement | null {
  const targetIds = [step.targetId, ...(step.fallbackTargetIds || [])].filter(
    Boolean,
  ) as string[];
  let found: HTMLElement | null = null;
  targetIds.some((targetId) => {
    found = document.querySelector<HTMLElement>(`[data-tour-id="${targetId}"]`);
    return found !== null;
  });
  return found;
}

function readTargetRect(step: TourStep): TargetRect | null {
  const element = getTargetElement(step);
  if (!element) return null;
  let rect = element.getBoundingClientRect();
  if (
    rect.top < 0 ||
    rect.bottom > window.innerHeight ||
    rect.left < 0 ||
    rect.right > window.innerWidth
  ) {
    element.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    rect = element.getBoundingClientRect();
  }
  const padding = 8;
  return {
    left: Math.max(8, rect.left - padding),
    top: Math.max(8, rect.top - padding),
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function getCoachmarkStyle(rect: TargetRect | null): CSSProperties {
  const width = Math.min(360, window.innerWidth - 32);
  if (!rect) {
    return {
      left: Math.max(16, (window.innerWidth - width) / 2),
      top: Math.max(24, window.innerHeight * 0.24),
    };
  }

  const gap = 14;
  const rightSpace = window.innerWidth - rect.left - rect.width;
  let left = clamp(rect.left, 16, window.innerWidth - width - 16);
  if (rightSpace >= width + gap) {
    left = rect.left + rect.width + gap;
  } else if (rect.left >= width + gap) {
    left = rect.left - width - gap;
  }
  const top = clamp(rect.top, 16, window.innerHeight - 260);

  return { left, top };
}

export function FirstRunTourProvider({ children }: { children: ReactNode }) {
  const { projectDirectory, recentProjects, recentProjectsLoaded } =
    useWorkspace();
  const [onboardingState, setOnboardingState] =
    useState<OnboardingState | null>(null);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [activeSource, setActiveSource] = useState<TourSource | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const autoStartedRef = useRef(false);
  const lastProjectDirectoryRef = useRef<string | null>(null);

  const activeStep = activeSource ? TOUR_STEPS[stepIndex] : null;
  const devMode = isTourDevModeEnabled();

  useEffect(() => {
    const bridge = getOnboardingBridge();
    if (!bridge) {
      setOnboardingState(fallbackState);
      setOnboardingLoaded(true);
      return undefined;
    }

    let mounted = true;
    bridge
      .getState()
      .then((state) => {
        if (!mounted) return undefined;
        setOnboardingState(state);
        setOnboardingLoaded(true);
        return undefined;
      })
      .catch(() => {
        if (!mounted) return undefined;
        setOnboardingState(fallbackState);
        setOnboardingLoaded(true);
        return undefined;
      });

    return () => {
      mounted = false;
    };
  }, []);

  const completeOnboarding = useCallback(
    async (req: CompleteOnboardingRequest) => {
      if (onboardingState?.completed && !devMode) return;
      const bridge = getOnboardingBridge();
      const fallbackNext: OnboardingState = {
        guideVersion: FIRST_RUN_GUIDE_VERSION,
        completed: true,
        completedAt: Date.now(),
        skipped: req.skipped === true,
        completedReason:
          req.completedReason ||
          (req.skipped === true ? 'skipped' : 'manual_finish'),
      };

      try {
        const next = bridge ? await bridge.complete(req) : fallbackNext;
        setOnboardingState(next);
      } catch {
        setOnboardingState(fallbackNext);
      }
    },
    [devMode, onboardingState?.completed],
  );

  const startTour = useCallback(
    ({ source }: StartTourRequest) => {
      const firstWorkspaceStep = getTourStepIndex('workspace-chat');
      setStepIndex(projectDirectory ? firstWorkspaceStep : 0);
      setActiveSource(source);
    },
    [projectDirectory],
  );

  const skipTour = useCallback(() => {
    setActiveSource(null);
    completeOnboarding({
      skipped: true,
      completedReason: 'skipped',
    }).catch(() => undefined);
  }, [completeOnboarding]);

  const notifyTourEvent = useCallback(
    (event: FirstRunTourEvent) => {
      const currentStep = TOUR_STEPS[stepIndex];
      const currentIndex = stepIndex;
      const settingsLocalComfyIndex = getTourStepIndex('settings-local-comfy');
      const settingsCloudSignInIndex = getTourStepIndex(
        'settings-cloud-signin',
      );
      const landingCreateIndex = getTourStepIndex('landing-create');
      const projectNameIndex = getTourStepIndex('project-name');
      const projectLocationIndex = getTourStepIndex('project-location');
      const projectCreateIndex = getTourStepIndex('project-create');
      const workspaceChatIndex = getTourStepIndex('workspace-chat');
      const setupStyleIndex = getTourStepIndex('setup-style');
      const setupDurationIndex = getTourStepIndex('setup-duration');
      const setupStoryIndex = getTourStepIndex('setup-story');
      const setupSubmitIndex = getTourStepIndex('setup-submit');
      const previewIndex = getTourStepIndex('workspace-preview');

      if (
        event === 'provider_choice_seen' &&
        activeSource &&
        currentStep?.id === 'landing-provider-choice'
      ) {
        setStepIndex(landingCreateIndex);
        return;
      }
      if (event === 'settings_local_setup_seen' && activeSource) {
        setStepIndex(settingsLocalComfyIndex);
        return;
      }
      if (event === 'settings_cloud_setup_seen' && activeSource) {
        setStepIndex(settingsCloudSignInIndex);
        return;
      }
      if (event === 'new_project_clicked' && activeSource) {
        if (currentIndex < projectNameIndex) {
          setStepIndex(projectNameIndex);
        }
        return;
      }
      if (event === 'project_name_valid' && activeSource) {
        if (currentIndex <= projectNameIndex) {
          setStepIndex(projectLocationIndex);
        }
        return;
      }
      if (event === 'project_location_seen' && activeSource) {
        if (currentIndex <= projectLocationIndex) {
          setStepIndex(projectLocationIndex);
        }
        return;
      }
      if (event === 'project_location_confirmed' && activeSource) {
        if (currentIndex <= projectLocationIndex) {
          setStepIndex(projectCreateIndex);
        }
        return;
      }
      if (event === 'project_opened') {
        if (activeSource) {
          setStepIndex(workspaceChatIndex);
        }
        return;
      }
      if (
        event === 'chat_visible' &&
        activeSource &&
        currentIndex < workspaceChatIndex
      ) {
        setStepIndex(workspaceChatIndex);
        return;
      }
      if (
        event === 'setup_wizard_visible' &&
        activeSource &&
        currentIndex < workspaceChatIndex
      ) {
        setStepIndex(workspaceChatIndex);
        return;
      }
      if (event === 'setup_style_selected' && activeSource) {
        if (currentIndex <= setupStyleIndex) {
          setStepIndex(setupDurationIndex);
        }
        return;
      }
      if (event === 'setup_duration_selected' && activeSource) {
        if (currentIndex <= setupDurationIndex) {
          setStepIndex(setupStoryIndex);
        }
        return;
      }
      if (event === 'setup_story_valid' && activeSource) {
        if (currentIndex <= setupStoryIndex) {
          setStepIndex(setupSubmitIndex);
        }
        return;
      }
      if (event === 'setup_story_submitted' || event === 'chat_prompt_sent') {
        completeOnboarding({
          completedReason: 'first_prompt_submitted',
        }).catch(() => undefined);
        if (activeSource) {
          setStepIndex(previewIndex);
        }
      }
    },
    [activeSource, completeOnboarding, stepIndex],
  );

  useEffect(() => {
    if (!onboardingLoaded || !recentProjectsLoaded || autoStartedRef.current) {
      return;
    }
    const shouldAutoStart =
      devMode ||
      (onboardingState?.completed === false &&
        recentProjects.length === 0 &&
        !projectDirectory);
    if (!shouldAutoStart) return;
    autoStartedRef.current = true;
    startTour({ source: 'auto' });
  }, [
    devMode,
    onboardingLoaded,
    onboardingState?.completed,
    projectDirectory,
    recentProjects.length,
    recentProjectsLoaded,
    startTour,
  ]);

  useEffect(() => {
    if (!projectDirectory) {
      lastProjectDirectoryRef.current = null;
      return;
    }
    if (lastProjectDirectoryRef.current === projectDirectory) return;
    lastProjectDirectoryRef.current = projectDirectory;
    notifyTourEvent('project_opened');
  }, [notifyTourEvent, projectDirectory]);

  useEffect(() => {
    if (!activeStep) {
      setTargetRect(null);
      return undefined;
    }

    let scheduledUpdate: number | null = null;
    const update = () => {
      setTargetRect(readTargetRect(activeStep));
    };
    const schedule = () => {
      if (scheduledUpdate) {
        window.clearTimeout(scheduledUpdate);
      }
      scheduledUpdate = window.setTimeout(update, 0);
    };

    update();
    const interval = window.setInterval(update, 250);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      if (scheduledUpdate) {
        window.clearTimeout(scheduledUpdate);
      }
      window.clearInterval(interval);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [activeStep]);

  const goBack = useCallback(() => {
    setStepIndex((current) => {
      const currentStep = TOUR_STEPS[current];
      if (
        currentStep?.id === 'settings-local-comfy' ||
        currentStep?.id === 'settings-cloud-signin'
      ) {
        return getTourStepIndex('landing-provider-choice');
      }
      if (currentStep?.id === 'landing-create') {
        return getTourStepIndex('landing-provider-choice');
      }
      return Math.max(0, current - 1);
    });
  }, []);

  const continueToProjects = useCallback(() => {
    requestLandingAction({ action: 'show-projects' });
    setStepIndex(getTourStepIndex('landing-create'));
  }, []);

  const goNext = useCallback(() => {
    setStepIndex((current) => {
      const currentStep = TOUR_STEPS[current];
      if (
        currentStep?.id === 'settings-local-comfy' ||
        currentStep?.id === 'settings-local-llm-provider' ||
        currentStep?.id === 'settings-local-llm-key' ||
        currentStep?.id === 'settings-local-llm-model' ||
        currentStep?.id === 'settings-local-test'
      ) {
        return current + 1;
      }
      if (
        currentStep?.id === 'settings-local-save' ||
        currentStep?.id === 'settings-cloud-toggles'
      ) {
        requestLandingAction({ action: 'show-projects' });
        return getTourStepIndex('landing-create');
      }
      if (currentStep?.id === 'settings-cloud-signin') {
        return getTourStepIndex('settings-cloud-toggles');
      }
      if (currentStep?.id === 'workspace-chat') {
        const setupVisible = document.querySelector(
          '[data-tour-id="setup-style-options"], [data-tour-id="workspace-setup-wizard"]',
        );
        return setupVisible
          ? getTourStepIndex('setup-style')
          : getTourStepIndex('chat-prompt');
      }
      if (current >= TOUR_STEPS.length - 1) {
        completeOnboarding({ completedReason: 'manual_finish' }).catch(
          () => undefined,
        );
        setActiveSource(null);
        return current;
      }
      return current + 1;
    });
  }, [completeOnboarding]);

  const handleProviderSignIn = useCallback(() => {
    const signInResult = window.electron.account?.signIn?.();
    signInResult?.catch(() => undefined);
    requestLandingAction({ action: 'open-settings', tab: 'connection' });
    notifyTourEvent('settings_cloud_setup_seen');
  }, [notifyTourEvent]);

  const handleProviderLocalSetup = useCallback(() => {
    requestLandingAction({ action: 'open-settings', tab: 'connection' });
    notifyTourEvent('settings_local_setup_seen');
  }, [notifyTourEvent]);

  const handleProviderContinue = useCallback(() => {
    continueToProjects();
    notifyTourEvent('provider_choice_seen');
  }, [continueToProjects, notifyTourEvent]);

  const handleUseProjectLocation = useCallback(() => {
    notifyTourEvent('project_location_confirmed');
  }, [notifyTourEvent]);

  let advanceButton: ReactNode = null;
  if (activeStep?.actionKind === 'provider-choice') {
    advanceButton = (
      <button
        type="button"
        className={styles.primaryButton}
        onClick={handleProviderContinue}
      >
        Continue without setup
      </button>
    );
  } else if (activeStep?.actionKind === 'project-location') {
    advanceButton = (
      <button
        type="button"
        className={styles.primaryButton}
        onClick={handleUseProjectLocation}
      >
        Use this location
      </button>
    );
  } else if (activeStep && !activeStep.requiresAction) {
    advanceButton = (
      <button type="button" className={styles.primaryButton} onClick={goNext}>
        {stepIndex === TOUR_STEPS.length - 1 ? 'Done' : 'Next'}
      </button>
    );
  }

  const value = useMemo<FirstRunTourContextValue>(
    () => ({
      isActive: activeSource !== null,
      startTour,
      skipTour,
      notifyTourEvent,
    }),
    [activeSource, notifyTourEvent, skipTour, startTour],
  );

  return (
    <FirstRunTourContext.Provider value={value}>
      {children}
      {activeStep ? (
        <div className={styles.layer} aria-live="polite">
          {targetRect ? (
            <div
              className={styles.spotlight}
              style={{
                left: targetRect.left,
                top: targetRect.top,
                width: targetRect.width,
                height: targetRect.height,
              }}
            />
          ) : null}
          <section
            className={styles.coachmark}
            style={getCoachmarkStyle(targetRect)}
            role="dialog"
            aria-label="First-run walkthrough"
          >
            <p className={styles.eyebrow}>
              Step {stepIndex + 1} of {TOUR_STEPS.length}
            </p>
            <h2 className={styles.title}>{activeStep.title}</h2>
            <p className={styles.body}>{activeStep.body}</p>
            {activeStep.actionHint ? (
              <p className={styles.actionHint}>{activeStep.actionHint}</p>
            ) : null}
            {activeStep.actionKind === 'provider-choice' ? (
              <div className={styles.choiceActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleProviderSignIn}
                >
                  Sign in to Dhee Cloud
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleProviderLocalSetup}
                >
                  Local setup
                </button>
              </div>
            ) : null}
            <div className={styles.controls}>
              <span className={styles.progress}>
                {activeSource === 'help' ? 'Help walkthrough' : 'First run'}
              </span>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={skipTour}
                >
                  Skip
                </button>
                {activeStep.actionKind === 'settings-setup' ? (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={continueToProjects}
                  >
                    Continue without setup
                  </button>
                ) : null}
                {stepIndex > 0 ? (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={goBack}
                  >
                    Back
                  </button>
                ) : null}
                {advanceButton}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </FirstRunTourContext.Provider>
  );
}

export function useFirstRunTour(): FirstRunTourContextValue {
  const context = useContext(FirstRunTourContext);
  if (!context) {
    throw new Error('useFirstRunTour must be used within FirstRunTourProvider');
  }
  return context;
}

const noopTourContext: FirstRunTourContextValue = {
  isActive: false,
  startTour: () => {},
  skipTour: () => {},
  notifyTourEvent: () => {},
};

export function useOptionalFirstRunTour(): FirstRunTourContextValue {
  return useContext(FirstRunTourContext) || noopTourContext;
}
