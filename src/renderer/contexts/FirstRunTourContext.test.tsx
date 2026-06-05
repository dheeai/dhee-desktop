import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  FIRST_RUN_TOUR_LANDING_ACTION_EVENT,
  FirstRunTourProvider,
  getCoachmarkStyle,
  useFirstRunTour,
  type FirstRunTourLandingAction,
} from './FirstRunTourContext';
import type {
  CompleteOnboardingRequest,
  OnboardingState,
} from '../../shared/onboardingTypes';

const mockComplete =
  jest.fn<(req?: CompleteOnboardingRequest) => Promise<OnboardingState>>();
const mockGetState = jest.fn<() => Promise<OnboardingState>>();
const mockSignIn = jest.fn<() => Promise<{ opened: boolean }>>();
const originalNodeEnv = process.env.NODE_ENV;
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

let mockRecentProjects: Array<{
  path: string;
  name: string;
  lastOpened: number;
}> = [];
let mockRecentProjectsLoaded = true;
let mockProjectDirectory: string | null = null;

jest.mock('./WorkspaceContext', () => ({
  useWorkspace: () => ({
    projectDirectory: mockProjectDirectory,
    recentProjects: mockRecentProjects,
    recentProjectsLoaded: mockRecentProjectsLoaded,
  }),
}));

function Harness() {
  const tour = useFirstRunTour();
  return (
    <>
      <div data-tour-id="landing-provider-status">Provider status</div>
      <input data-tour-id="settings-comfy-url" aria-label="ComfyUI URL" />
      <div data-tour-id="settings-llm-provider">LLM provider</div>
      <input data-tour-id="settings-llm-base-url" aria-label="LLM base URL" />
      <input data-tour-id="settings-llm-api-key" aria-label="LLM API key" />
      <input data-tour-id="settings-llm-model" aria-label="LLM model" />
      <button type="button" data-tour-id="settings-provider-test">
        Test all providers
      </button>
      <button type="button" data-tour-id="settings-save-connection">
        Save & Restart
      </button>
      <button type="button" data-tour-id="settings-cloud-sign-in">
        Settings Sign In
      </button>
      <div data-tour-id="settings-cloud-toggles">Cloud toggles</div>
      <button
        type="button"
        data-tour-id="landing-new-project"
        onClick={() => tour.notifyTourEvent('new_project_clicked')}
      >
        New Project
      </button>
      <input
        data-tour-id="new-project-name"
        aria-label="Project name"
        onChange={(event) => {
          if (event.currentTarget.value.trim()) {
            tour.notifyTourEvent('project_name_valid');
          }
        }}
      />
      <div data-tour-id="new-project-location">Project location</div>
      <button type="button" data-tour-id="new-project-choose-folder">
        Choose Folder
      </button>
      <button
        type="button"
        data-tour-id="new-project-create"
        onClick={() => tour.notifyTourEvent('project_opened')}
      >
        Create Project
      </button>
      <button type="button" onClick={() => tour.startTour({ source: 'help' })}>
        Help
      </button>
      <div data-tour-id="workspace-chat-panel">Chat panel</div>
      <div data-tour-id="workspace-setup-wizard">Setup wizard</div>
      <button
        type="button"
        data-tour-id="setup-style-options"
        onClick={() => tour.notifyTourEvent('setup_style_selected')}
      >
        Style options
      </button>
      <button
        type="button"
        data-tour-id="setup-duration-options"
        onClick={() => tour.notifyTourEvent('setup_duration_selected')}
      >
        Duration options
      </button>
      <textarea
        data-tour-id="setup-story-input"
        aria-label="Story input"
        onChange={(event) => {
          if (event.currentTarget.value.trim()) {
            tour.notifyTourEvent('setup_story_valid');
          }
        }}
      />
      <button
        type="button"
        data-tour-id="setup-story-continue"
        onClick={() => tour.notifyTourEvent('setup_story_submitted')}
      >
        Continue setup
      </button>
      <textarea data-tour-id="workspace-chat-input" aria-label="Chat input" />
      <div data-tour-id="workspace-preview">Preview</div>
    </>
  );
}

function renderTour() {
  return render(
    <FirstRunTourProvider>
      <Harness />
    </FirstRunTourProvider>,
  );
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  });
}

async function clickNextToHeading(heading: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  expect(await screen.findByText(heading)).not.toBeNull();
}

async function advanceThroughSetupWalkthrough() {
  // The walkthrough no longer auto-starts on launch; launch it via the
  // Help entry point (the manual trigger), then drive the steps.
  fireEvent.click(await screen.findByRole('button', { name: 'Help' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Start walkthrough' }),
  );
  expect(await screen.findByText('Local ComfyUI lives here')).not.toBeNull();
  await clickNextToHeading('Choose the local LLM provider');
  await clickNextToHeading('Base URL comes before the model');
  await clickNextToHeading('Model IDs come before the key');
  await clickNextToHeading('API keys go after the model');
  await clickNextToHeading('Test providers when ready');
  await clickNextToHeading('Save connection changes');
  await clickNextToHeading('Cloud sign-in starts here');
  await clickNextToHeading('Cloud mode toggles live in Connection');
  await clickNextToHeading('Create your first project');
}

describe('FirstRunTourProvider', () => {
  beforeEach(() => {
    mockRecentProjects = [];
    mockRecentProjectsLoaded = true;
    mockProjectDirectory = null;
    mockGetState.mockReset();
    mockComplete.mockReset();
    mockSignIn.mockReset();
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.dhee_FIRST_RUN_TOUR_DEV_MODE;
    setViewport(originalInnerWidth, originalInnerHeight);

    mockGetState.mockResolvedValue({
      guideVersion: 3,
      completed: false,
      completedAt: null,
      skipped: false,
    });
    mockComplete.mockImplementation(async (req) => {
      const skipped =
        typeof req === 'object' &&
        req !== null &&
        (req as { skipped?: unknown }).skipped === true;
      const completedReason: OnboardingState['completedReason'] =
        req &&
        typeof req === 'object' &&
        req !== null &&
        (req as CompleteOnboardingRequest).completedReason
          ? (req as CompleteOnboardingRequest).completedReason
          : 'manual_finish';
      return {
        guideVersion: 3,
        completed: true,
        completedAt: 123,
        skipped,
        completedReason,
      };
    });
    mockSignIn.mockResolvedValue({ opened: true });

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        onboarding: {
          getState: mockGetState,
          complete: mockComplete,
        },
        account: {
          signIn: mockSignIn,
        },
      },
    });
  });

  it('does not auto-start on launch, but Help can launch it', async () => {
    renderTour();

    // Walkthrough disconnected: nothing appears automatically for a brand
    // new user with no recent projects.
    await waitFor(() => {
      expect(screen.queryByText('Choose how Dhee runs')).toBeNull();
    });

    // The tour itself is intact and still launchable on demand.
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    expect(await screen.findByText('Choose how Dhee runs')).not.toBeNull();
    expect(screen.getByText(/Dhee can use Dhee Cloud credits/i)).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Start walkthrough' }),
    ).not.toBeNull();
  });

  it('does not auto-start even when an account is signed in', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        onboarding: {
          getState: mockGetState,
          complete: mockComplete,
        },
        account: {
          signIn: mockSignIn,
          get: jest.fn(async () => ({ email: 'user@example.com' })),
        },
      },
    });

    renderTour();

    await waitFor(() => {
      expect(screen.queryByText('Choose how Dhee runs')).toBeNull();
    });
  });

  it('does not auto-start for users with recent projects', async () => {
    mockRecentProjects = [
      { path: '/projects/existing', name: 'existing', lastOpened: 1 },
    ];

    renderTour();

    await waitFor(() => {
      expect(screen.queryByText('Choose how Dhee runs')).toBeNull();
    });
  });

  it('starts the linear walkthrough by opening local Connection settings', async () => {
    const actions: FirstRunTourLandingAction[] = [];
    const handler = (event: Event) => {
      actions.push((event as CustomEvent<FirstRunTourLandingAction>).detail);
    };
    window.addEventListener(FIRST_RUN_TOUR_LANDING_ACTION_EVENT, handler);

    try {
      renderTour();

      fireEvent.click(await screen.findByRole('button', { name: 'Help' }));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Start walkthrough' }),
      );

      expect(actions).toContainEqual({
        action: 'open-settings',
        tab: 'connection',
      });
      expect(
        await screen.findByText('Local ComfyUI lives here'),
      ).not.toBeNull();
    } finally {
      window.removeEventListener(FIRST_RUN_TOUR_LANDING_ACTION_EVENT, handler);
    }
  });

  it('walks through local setup, then Cloud signup, then project creation', async () => {
    renderTour();

    await advanceThroughSetupWalkthrough();

    expect(await screen.findByText('Create your first project')).not.toBeNull();
    expect(screen.getByText('Click New Project to continue.')).not.toBeNull();
  });

  it('can right-align coachmarks inside wide settings rows', () => {
    setViewport(1986, 1124);

    expect(
      getCoachmarkStyle({ left: 320, top: 548, width: 1600, height: 50 }),
    ).toEqual({ left: 1560, top: 548 });
  });

  it('can place coachmarks below wide prompt inputs', () => {
    setViewport(1468, 1136);

    expect(
      getCoachmarkStyle(
        { left: 36, top: 192, width: 1396, height: 355 },
        'below-or-above-target',
      ),
    ).toEqual({ left: 1072, top: 561 });
  });

  it('does not launch Cloud sign-in until the optional Cloud step action is clicked', async () => {
    renderTour();

    fireEvent.click(await screen.findByRole('button', { name: 'Help' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Start walkthrough' }),
    );
    expect(await screen.findByText('Local ComfyUI lives here')).not.toBeNull();
    await clickNextToHeading('Choose the local LLM provider');
    await clickNextToHeading('Base URL comes before the model');
    await clickNextToHeading('Model IDs come before the key');
    await clickNextToHeading('API keys go after the model');
    await clickNextToHeading('Test providers when ready');
    await clickNextToHeading('Save connection changes');
    await clickNextToHeading('Cloud sign-in starts here');

    expect(mockSignIn).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in to Dhee Cloud' }),
    );

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Cloud sign-in starts here')).not.toBeNull();
  });

  it('advances from project name to location, then create project', async () => {
    renderTour();
    await advanceThroughSetupWalkthrough();
    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));

    expect(await screen.findByText('Name the project')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Demo' },
    });
    expect(await screen.findByRole('button', { name: 'Next' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      await screen.findByText('Confirm the project location'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));

    expect(await screen.findByText('Create the project folder')).not.toBeNull();
  });

  it('lets Help replay after completion', async () => {
    mockGetState.mockResolvedValue({
      guideVersion: 3,
      completed: true,
      completedAt: 1,
      skipped: false,
      completedReason: 'first_prompt_submitted',
    });

    renderTour();
    fireEvent.click(await screen.findByRole('button', { name: 'Help' }));

    expect(await screen.findByText('Choose how Dhee runs')).not.toBeNull();
  });

  it('persists skip', async () => {
    renderTour();

    fireEvent.click(await screen.findByRole('button', { name: 'Help' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(mockComplete).toHaveBeenCalledWith({
        skipped: true,
        completedReason: 'skipped',
      });
    });
  });

  it('does not persist completion when a project opens', async () => {
    const view = renderTour();
    fireEvent.click(await screen.findByRole('button', { name: 'Help' }));
    await screen.findByText('Choose how Dhee runs');

    mockProjectDirectory = '/projects/first';
    view.rerender(
      <FirstRunTourProvider>
        <Harness />
      </FirstRunTourProvider>,
    );

    await screen.findByText('Chat drives the workflow');
    expect(mockComplete).not.toHaveBeenCalledWith({
      completedReason: 'project_opened',
    });
  });

  it('guides setup style, duration, story, then persists first prompt submission', async () => {
    renderTour();
    await advanceThroughSetupWalkthrough();
    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Demo' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Use this location' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create Project' }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Pick a visual style')).not.toBeNull();
    fireEvent.click(screen.getByText('Style options'));

    expect(await screen.findByText('Choose the duration')).not.toBeNull();
    fireEvent.click(screen.getByText('Duration options'));

    expect(await screen.findByText('Enter the first prompt')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Story input'), {
      target: { value: 'A product launch video' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Send the setup prompt')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }));

    await waitFor(() => {
      expect(mockComplete).toHaveBeenCalledWith({
        completedReason: 'first_prompt_submitted',
      });
    });
    expect(
      await screen.findByText('Outputs appear in the preview area'),
    ).not.toBeNull();
  });

  it('does not auto-start even in tour dev mode (walkthrough disconnected)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.dhee_FIRST_RUN_TOUR_DEV_MODE = '1';
    mockRecentProjects = [
      { path: '/projects/existing', name: 'existing', lastOpened: 1 },
    ];
    mockGetState.mockResolvedValue({
      guideVersion: 3,
      completed: true,
      completedAt: 1,
      skipped: false,
      completedReason: 'first_prompt_submitted',
    });

    renderTour();

    await waitFor(() => {
      expect(screen.queryByText('Choose how Dhee runs')).toBeNull();
    });
  });
});
