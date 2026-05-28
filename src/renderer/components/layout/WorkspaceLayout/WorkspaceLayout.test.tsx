import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type * as ReactTypes from 'react';
import type { ProjectSwitchGuard } from '../../../types/workspace';
import WorkspaceLayout from './WorkspaceLayout';

const mockCloseProject = jest.fn();
const mockRegisterProjectSwitchGuard = jest.fn();
let mockProjectDirectory: string | null = '/tmp/BurgerEating.dhee';
let mockProjectName: string | null = 'BurgerEating';

jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    closeProject: mockCloseProject,
    projectName: mockProjectName,
    projectDirectory: mockProjectDirectory,
    registerProjectSwitchGuard: mockRegisterProjectSwitchGuard,
  }),
}));

jest.mock(
  '../../preview/PreviewPanel/PreviewPanel',
  () =>
    function MockPreviewPanel() {
      return <div data-testid="preview-panel" />;
    },
);

jest.mock(
  '../../chat/ChatPanelEmbedded/ChatPanelEmbedded',
  () =>
    function MockChatPanelEmbedded() {
      return <div data-testid="chat-panel" />;
    },
);

jest.mock(
  '../StatusBar/StatusBar',
  () =>
    function MockStatusBar() {
      return <div data-testid="status-bar" />;
    },
);

jest.mock('react-resizable-panels', () => {
  const react = jest.requireActual<typeof ReactTypes>('react');
  return {
    PanelGroup: function PanelGroup({
      children,
    }: {
      children: ReactTypes.ReactNode;
    }) {
      return <div>{children}</div>;
    },
    PanelResizeHandle: function PanelResizeHandle() {
      return <div data-testid="resize-handle" />;
    },
    Panel: react.forwardRef(
      (
        { children }: { children: ReactTypes.ReactNode },
        ref: ReactTypes.ForwardedRef<unknown>,
      ) => {
        react.useImperativeHandle(ref, () => ({
          isCollapsed: () => false,
          collapse: jest.fn(),
          expand: jest.fn(),
        }));
        return <div>{children}</div>;
      },
    ),
  };
});

describe('WorkspaceLayout runner cancellation guards', () => {
  beforeEach(() => {
    mockCloseProject.mockClear();
    mockRegisterProjectSwitchGuard.mockClear();
    mockProjectDirectory = '/tmp/BurgerEating.dhee';
    mockProjectName = 'BurgerEating';
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    (window as unknown as { dhee: unknown }).dhee = {
      runnerStatus: jest.fn(async () => ({ active: false })),
      runnerCancel: jest.fn(async () => ({ cancelled: true })),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Back from the owning project confirms, calls guarded cancel, then closes', async () => {
    const runnerCancel = jest.fn(async () => ({ cancelled: true }));
    (window as unknown as { dhee: Record<string, unknown> }).dhee = {
      runnerStatus: jest.fn(async () => ({
        active: true,
        projectName: 'BurgerEating',
        projectDir: '/tmp/BurgerEating.dhee',
      })),
      runnerCancel,
    };

    render(<WorkspaceLayout />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back/i })).toHaveAttribute(
        'title',
        expect.stringMatching(/cancel/i),
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back/i }));
    });

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(runnerCancel).toHaveBeenCalledWith({
      projectDir: '/tmp/BurgerEating.dhee',
    });
    expect(mockCloseProject).toHaveBeenCalledTimes(1);
  });

  it('Back leaves the owning project open when the user declines cancellation', async () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    const runnerCancel = jest.fn(async () => ({ cancelled: true }));
    (window as unknown as { dhee: Record<string, unknown> }).dhee = {
      runnerStatus: jest.fn(async () => ({
        active: true,
        projectName: 'BurgerEating',
        projectDir: '/tmp/BurgerEating.dhee',
      })),
      runnerCancel,
    };

    render(<WorkspaceLayout />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back/i })).toHaveAttribute(
        'title',
        expect.stringMatching(/cancel/i),
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back/i }));
    });

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(runnerCancel).not.toHaveBeenCalled();
    expect(mockCloseProject).not.toHaveBeenCalled();
  });

  it('registers the same confirm-and-cancel guard for project-to-project switches', async () => {
    const runnerCancel = jest.fn(async () => ({ cancelled: true }));
    (window as unknown as { dhee: Record<string, unknown> }).dhee = {
      runnerStatus: jest.fn(async () => ({
        active: true,
        projectName: 'BurgerEating',
        projectDir: '/tmp/BurgerEating.dhee',
      })),
      runnerCancel,
    };

    render(<WorkspaceLayout />);
    await waitFor(() =>
      expect(mockRegisterProjectSwitchGuard).toHaveBeenCalledTimes(1),
    );

    const guard = mockRegisterProjectSwitchGuard.mock
      .calls[0][0] as ProjectSwitchGuard;
    const result = await guard({
      fromProjectDirectory: '/tmp/BurgerEating.dhee',
      toProjectDirectory: '/tmp/SummerSky.dhee',
    });

    expect(result).toBe(true);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(runnerCancel).toHaveBeenCalledWith({
      projectDir: '/tmp/BurgerEating.dhee',
    });
  });

  it('does not cancel a runner owned by another project from the current screen', async () => {
    const runnerCancel = jest.fn(async () => ({ cancelled: true }));
    (window as unknown as { dhee: Record<string, unknown> }).dhee = {
      runnerStatus: jest.fn(async () => ({
        active: true,
        projectName: 'SummerSky',
        projectDir: '/tmp/SummerSky.dhee',
      })),
      runnerCancel,
    };

    render(<WorkspaceLayout />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back/i })).toHaveAttribute(
        'title',
        'Back to Landing',
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back/i }));
    });

    expect(window.confirm).not.toHaveBeenCalled();
    expect(runnerCancel).not.toHaveBeenCalled();
    expect(mockCloseProject).toHaveBeenCalledTimes(1);
  });
});
