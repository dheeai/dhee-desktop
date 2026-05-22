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
  | 'new_project_clicked'
  | 'project_name_valid'
  | 'project_opened'
  | 'chat_visible'
  | 'setup_wizard_visible';

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
  | 'landing-create'
  | 'project-name'
  | 'project-create'
  | 'workspace-chat'
  | 'workspace-setup'
  | 'workspace-run'
  | 'workspace-preview';

interface TourStep {
  id: TourStepId;
  title: string;
  body: string;
  targetId?: string;
  fallbackTargetIds?: string[];
  actionHint?: string;
  requiresAction?: boolean;
  actionKind?: 'provider-choice';
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
    body: 'Dhee Cloud is the fastest path: sign in and use credits. Local providers work too when ComfyUI and an LLM are configured in Settings.',
    actionHint:
      'Pick a setup path now, or continue and create a project first.',
    actionKind: 'provider-choice',
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
    body: 'Give this workspace a clear name. As soon as the name is valid, the walkthrough moves to the create action.',
    actionHint: 'Type a project name to continue.',
    requiresAction: true,
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
    body: 'This is where you describe the video, ask for edits, inspect progress, and continue generation.',
  },
  {
    id: 'workspace-setup',
    targetId: 'workspace-setup-wizard',
    title: 'Choose the creative starting point',
    body: 'Fresh projects open a setup wizard in chat. Pick the style, duration, and story so the agent has enough direction to start.',
  },
  {
    id: 'workspace-run',
    targetId: 'workspace-run-control',
    fallbackTargetIds: ['workspace-chat-input'],
    title: 'Generate or ask for changes',
    body: 'Use Resume when a project is ready to continue, or type directly in chat to ask for edits while the pipeline runs.',
  },
  {
    id: 'workspace-preview',
    targetId: 'workspace-preview',
    title: 'Preview, edit, and export outputs',
    body: 'Generated images, videos, timelines, and export tools appear in the preview area. Keep chat open for targeted changes.',
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
  const rect = element.getBoundingClientRect();
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
      const landingCreateIndex = getTourStepIndex('landing-create');
      const projectNameIndex = getTourStepIndex('project-name');
      const projectCreateIndex = getTourStepIndex('project-create');
      const workspaceChatIndex = getTourStepIndex('workspace-chat');
      const workspaceSetupIndex = getTourStepIndex('workspace-setup');

      if (
        event === 'provider_choice_seen' &&
        activeSource &&
        currentStep?.id === 'landing-provider-choice'
      ) {
        setStepIndex(landingCreateIndex);
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
          setStepIndex(projectCreateIndex);
        }
        return;
      }
      if (event === 'project_opened') {
        completeOnboarding({ completedReason: 'project_opened' }).catch(
          () => undefined,
        );
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
        currentIndex < workspaceSetupIndex
      ) {
        setStepIndex(workspaceSetupIndex);
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
    if (!projectDirectory) return;
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
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  const goNext = useCallback(() => {
    setStepIndex((current) => {
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
  }, []);

  const handleProviderLocalSetup = useCallback(() => {
    requestLandingAction({ action: 'open-settings', tab: 'connection' });
  }, []);

  const handleProviderContinue = useCallback(() => {
    requestLandingAction({ action: 'show-projects' });
    notifyTourEvent('provider_choice_seen');
  }, [notifyTourEvent]);

  let advanceButton: ReactNode = null;
  if (activeStep?.actionKind === 'provider-choice') {
    advanceButton = (
      <button
        type="button"
        className={styles.primaryButton}
        onClick={handleProviderContinue}
      >
        Continue
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
