import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  FIRST_RUN_TOUR_LANDING_ACTION_EVENT,
  FirstRunTourProvider,
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
      <button type="button" data-tour-id="new-project-create">
        Create Project
      </button>
      <button type="button" onClick={() => tour.startTour({ source: 'help' })}>
        Help
      </button>
      <div data-tour-id="workspace-chat-panel">Chat panel</div>
      <div data-tour-id="workspace-setup-wizard">Setup wizard</div>
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

    mockGetState.mockResolvedValue({
      guideVersion: 2,
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
        guideVersion: 2,
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

  it('auto-starts for a new user with no recent projects', async () => {
    renderTour();

    expect(await screen.findByText('Choose how Dhee runs')).not.toBeNull();
    expect(screen.getByText(/Dhee Cloud is the fastest path/i)).not.toBeNull();
  });

  it('auto-starts even when an account is signed in', async () => {
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

    expect(await screen.findByText('Choose how Dhee runs')).not.toBeNull();
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

  it('continues from provider choice to project creation', async () => {
    renderTour();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Create your first project')).not.toBeNull();
    expect(screen.getByText('Click New Project to continue.')).not.toBeNull();
  });

  it('calls account sign-in from the provider choice', async () => {
    renderTour();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Sign in to Dhee Cloud' }),
    );

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledTimes(1);
    });
  });

  it('requests Connection settings from the local setup action', async () => {
    const actions: FirstRunTourLandingAction[] = [];
    const handler = (event: Event) => {
      actions.push((event as CustomEvent<FirstRunTourLandingAction>).detail);
    };
    window.addEventListener(FIRST_RUN_TOUR_LANDING_ACTION_EVENT, handler);

    try {
      renderTour();
      fireEvent.click(
        await screen.findByRole('button', { name: 'Local setup' }),
      );

      expect(actions).toContainEqual({
        action: 'open-settings',
        tab: 'connection',
      });
    } finally {
      window.removeEventListener(FIRST_RUN_TOUR_LANDING_ACTION_EVENT, handler);
    }
  });

  it('advances from project name to create project when the name is valid', async () => {
    renderTour();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));

    expect(await screen.findByText('Name the project')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Demo' },
    });

    expect(await screen.findByText('Create the project folder')).not.toBeNull();
  });

  it('lets Help replay after completion', async () => {
    mockGetState.mockResolvedValue({
      guideVersion: 2,
      completed: true,
      completedAt: 1,
      skipped: false,
      completedReason: 'project_opened',
    });

    renderTour();
    fireEvent.click(await screen.findByRole('button', { name: 'Help' }));

    expect(await screen.findByText('Choose how Dhee runs')).not.toBeNull();
  });

  it('persists skip', async () => {
    renderTour();

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(mockComplete).toHaveBeenCalledWith({
        skipped: true,
        completedReason: 'skipped',
      });
    });
  });

  it('persists completion when a project opens', async () => {
    const view = renderTour();
    await screen.findByText('Choose how Dhee runs');

    mockProjectDirectory = '/projects/first';
    view.rerender(
      <FirstRunTourProvider>
        <Harness />
      </FirstRunTourProvider>,
    );

    await waitFor(() => {
      expect(mockComplete).toHaveBeenCalledWith({
        completedReason: 'project_opened',
      });
    });
  });

  it('dev mode forces the tour even after completion and recent projects', async () => {
    process.env.NODE_ENV = 'development';
    process.env.dhee_FIRST_RUN_TOUR_DEV_MODE = '1';
    mockRecentProjects = [
      { path: '/projects/existing', name: 'existing', lastOpened: 1 },
    ];
    mockGetState.mockResolvedValue({
      guideVersion: 2,
      completed: true,
      completedAt: 1,
      skipped: false,
      completedReason: 'project_opened',
    });

    renderTour();

    expect(await screen.findByText('Choose how Dhee runs')).not.toBeNull();
  });
});
