import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import LandingScreen from './LandingScreen';

const mockOpenProject = jest.fn<(path: string) => Promise<void>>();
const mockRefreshRecentProjects = jest.fn<() => Promise<void>>();
const mockUpdateTheme = jest.fn<(themeId: string) => Promise<void>>();
const mockSaveConnectionSettings = jest.fn<() => Promise<boolean>>();
const mockClearError = jest.fn<() => void>();
const mockStartTour = jest.fn();
const mockNotifyTourEvent = jest.fn();
const mockTourLandingActionEvent = 'dhee:first-run-tour:landing-action';
const mockSettingsPanel = jest.fn(({ initialTab }: { initialTab: string }) => (
  <div data-testid="settings-panel">Settings: {initialTab}</div>
));
let mockProjectLoading = false;
let mockRecentProjectsLoaded = true;

let mockRecentProjects = [
  {
    path: '/projects/demo',
    name: 'Demo',
    lastOpened: Date.now(),
  },
];

jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    recentProjects: mockRecentProjects,
    recentProjectsLoaded: mockRecentProjectsLoaded,
    openProject: mockOpenProject,
    refreshRecentProjects: mockRefreshRecentProjects,
    isLoading: false,
  }),
}));

jest.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({
    isLoading: mockProjectLoading,
  }),
}));

jest.mock('../../../contexts/AppSettingsContext', () => ({
  useAppSettings: () => ({
    themeId: 'studio-neutral',
    settings: {},
    updateTheme: mockUpdateTheme,
    saveConnectionSettings: mockSaveConnectionSettings,
    isSavingConnection: false,
    error: null,
    clearError: mockClearError,
  }),
}));

jest.mock('../../../contexts/FirstRunTourContext', () => ({
  FIRST_RUN_TOUR_LANDING_ACTION_EVENT: 'dhee:first-run-tour:landing-action',
  useOptionalFirstRunTour: () => ({
    isActive: false,
    startTour: mockStartTour,
    skipTour: jest.fn(),
    notifyTourEvent: mockNotifyTourEvent,
  }),
}));

jest.mock(
  '../../SettingsPanel',
  () => (props: { initialTab: string }) => mockSettingsPanel(props),
);
jest.mock('../NewProjectDialog/NewProjectDialog', () => () => null);

function buildRecentProjects(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const projectNumber = index + 1;
    const name = `project-${projectNumber.toString().padStart(2, '0')}`;
    return {
      path: `/projects/${name}`,
      name,
      lastOpened: projectNumber,
    };
  });
}

describe('LandingScreen', () => {
  const mockReadFile = jest.fn<(path: string) => Promise<string | null>>();
  const mockCheckFileExists = jest.fn<(path: string) => Promise<boolean>>();
  const mockRenameProject =
    jest.fn<(projectPath: string, newName: string) => Promise<string>>();
  const mockDeleteProject = jest.fn<(projectPath: string) => Promise<void>>();
  const mockGetVersion = jest.fn<() => Promise<string>>();

  beforeEach(() => {
    mockOpenProject.mockReset();
    mockRefreshRecentProjects.mockReset();
    mockUpdateTheme.mockReset();
    mockSaveConnectionSettings.mockReset();
    mockClearError.mockReset();
    mockStartTour.mockReset();
    mockNotifyTourEvent.mockReset();
    mockSettingsPanel.mockClear();
    mockReadFile.mockReset();
    mockCheckFileExists.mockReset();
    mockRenameProject.mockReset();
    mockDeleteProject.mockReset();
    mockGetVersion.mockReset();
    mockProjectLoading = false;
    mockRecentProjectsLoaded = true;
    mockRecentProjects = [
      {
        path: '/projects/demo',
        name: 'Demo',
        lastOpened: Date.now(),
      },
    ];

    mockReadFile.mockResolvedValue(
      JSON.stringify({
        title: 'Stale Manifest Title',
        description: 'Test project',
        scenes: [],
        characters: [],
      }),
    );
    mockCheckFileExists.mockResolvedValue(false);
    mockRenameProject.mockResolvedValue('/projects/demo-renamed');
    mockDeleteProject.mockResolvedValue(undefined);
    mockRefreshRecentProjects.mockResolvedValue(undefined);
    mockGetVersion.mockResolvedValue('1.0.0');

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        project: {
          readFile: mockReadFile,
          checkFileExists: mockCheckFileExists,
          renameProject: mockRenameProject,
          deleteProject: mockDeleteProject,
          selectDirectory: jest.fn(),
        },
        app: {
          getVersion: mockGetVersion,
        },
      },
    });
  });

  it('marks the primary first-run actions as walkthrough targets', async () => {
    mockRecentProjects = [];

    render(<LandingScreen />);

    expect(await screen.findByText('Dhee Desktop')).not.toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'New Project' })
        .getAttribute('data-tour-id'),
    ).toBe('landing-new-project');
    expect(
      screen
        .getByRole('button', { name: 'Open Workspace' })
        .getAttribute('data-tour-id'),
    ).toBe('landing-open-workspace');
    expect(screen.getByTitle(/LLM:/).getAttribute('data-tour-id')).toBe(
      'landing-provider-status',
    );
    expect(
      screen
        .getByRole('button', { name: 'Sign In' })
        .getAttribute('data-tour-id'),
    ).toBe('landing-sign-in');
    expect(screen.queryByText('Set up Dhee Desktop')).toBeNull();
    expect(screen.queryByText('Dhee Cloud')).toBeNull();
  });

  it('opens Connection settings when the walkthrough asks for local setup', async () => {
    mockRecentProjects = [];

    render(<LandingScreen />);
    expect(await screen.findByText('Dhee Desktop')).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(mockTourLandingActionEvent, {
          detail: { action: 'open-settings', tab: 'connection' },
        }),
      );
    });

    expect((await screen.findByTestId('settings-panel')).textContent).toBe(
      'Settings: connection',
    );
  });

  it('notifies the walkthrough when New Project is clicked', async () => {
    render(<LandingScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));

    expect(mockNotifyTourEvent).toHaveBeenCalledWith('new_project_clicked');
  });

  it('lets Help replay the first-run walkthrough', async () => {
    mockRecentProjects = [];

    render(<LandingScreen />);
    expect(
      await screen.findByText(
        'No projects yet. Create your first project to get started.',
      ),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(mockStartTour).toHaveBeenCalledWith({ source: 'help' });
  });

  it('keeps new project available while project work is loading', async () => {
    mockProjectLoading = true;

    render(<LandingScreen />);

    expect(
      (await screen.findByRole('button', {
        name: 'New Project',
      })) as HTMLButtonElement,
    ).toHaveProperty('disabled', false);
  });

  it('opens the rename dialog from the project card and submits rename', async () => {
    render(<LandingScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Rename demo' }));
    expect(
      screen.getByRole('dialog', { name: 'Rename project' }),
    ).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Demo Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename Project' }));

    await waitFor(() => {
      expect(mockRenameProject).toHaveBeenCalledWith(
        '/projects/demo',
        'Demo Renamed',
      );
    });
    expect(mockRefreshRecentProjects).toHaveBeenCalled();
  });

  it('uses the project folder name instead of a stale manifest title', async () => {
    render(<LandingScreen />);

    expect(await screen.findByText('demo')).not.toBeNull();
    expect(screen.queryByText('Stale Manifest Title')).toBeNull();
  });

  it('opens the delete dialog from the project card and submits delete', async () => {
    render(<LandingScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete demo' }));
    expect(
      screen.getByRole('dialog', { name: 'Delete project' }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Project' }));

    await waitFor(() => {
      expect(mockDeleteProject).toHaveBeenCalledWith('/projects/demo');
    });
    expect(mockRefreshRecentProjects).toHaveBeenCalled();
  });

  it('shows 9 project cards on the first page and paginates to the rest', async () => {
    mockRecentProjects = buildRecentProjects(11);

    render(<LandingScreen />);

    expect(
      await screen.findByRole('button', { name: 'Rename project-11' }),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Rename project-03' }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Rename project-02' }),
    ).toBeNull();
    expect(screen.getByText('1-9 of 11')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next projects page' }));

    expect(
      await screen.findByRole('button', { name: 'Rename project-02' }),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Rename project-01' }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Rename project-03' }),
    ).toBeNull();
    expect(screen.getByText('10-11 of 11')).not.toBeNull();
  });

  it('does not show pagination for 9 or fewer projects', async () => {
    mockRecentProjects = buildRecentProjects(9);

    render(<LandingScreen />);

    expect(
      await screen.findByRole('button', { name: 'Rename project-09' }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Next projects page' }),
    ).toBeNull();
  });

  it('clamps the active project page when the current page disappears', async () => {
    mockRecentProjects = buildRecentProjects(10);
    const { rerender } = render(<LandingScreen />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Next projects page' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Rename project-01' }),
    ).not.toBeNull();

    mockRecentProjects = buildRecentProjects(9);
    rerender(<LandingScreen />);

    expect(
      await screen.findByRole('button', { name: 'Rename project-09' }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Rename project-01' }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Next projects page' }),
    ).toBeNull();
  });
});
