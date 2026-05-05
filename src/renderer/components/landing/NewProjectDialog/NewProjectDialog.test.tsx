import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewProjectDialog from './NewProjectDialog';

const mockCreateProject =
  jest.fn<
    (directory: string, name: string, description?: string) => Promise<boolean>
  >();
const mockCloseProject = jest.fn<() => void>();
const mockOpenProject = jest.fn<(path: string) => Promise<void>>();

jest.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({
    createProject: mockCreateProject,
    closeProject: mockCloseProject,
    error: null,
    isLoading: false,
  }),
}));

jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    openProject: mockOpenProject,
  }),
}));

describe('NewProjectDialog', () => {
  const mockSelectDirectory = jest.fn<() => Promise<string | null>>();
  const mockCreateFolder =
    jest.fn<
      (
        basePath: string,
        relativePath: string,
        meta?: unknown,
      ) => Promise<string | null>
    >();
  const mockCheckFileExists = jest.fn<(path: string) => Promise<boolean>>();

  beforeEach(() => {
    mockCreateProject.mockReset();
    mockCloseProject.mockReset();
    mockOpenProject.mockReset();
    mockSelectDirectory.mockReset();
    mockCreateFolder.mockReset();
    mockCheckFileExists.mockReset();

    mockCreateProject.mockResolvedValue(true);
    mockOpenProject.mockResolvedValue(undefined);
    mockCreateFolder.mockResolvedValue('/projects/demo');

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        project: {
          selectDirectory: mockSelectDirectory,
          createFolder: mockCreateFolder,
          checkFileExists: mockCheckFileExists,
        },
      },
    });
  });

  async function pickFolder(path: string) {
    mockSelectDirectory.mockResolvedValue(path);
    await waitFor(() => {
      expect(
        (
          screen.getByRole('button', {
            name: 'Choose Folder',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose Folder' }));
    await waitFor(() => {
      expect(screen.getByText(path)).not.toBeNull();
    });
  }

  it('shows an error when the selected directory is already a project', async () => {
    mockCheckFileExists.mockImplementation(async (path: string) => {
      return path === '/projects/existing/project.json';
    });

    const onClose = jest.fn();
    render(<NewProjectDialog isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'demo' },
    });
    await pickFolder('/projects/existing');

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Selected location is already a Kshana project. Choose a parent folder instead.',
        ),
      ).not.toBeNull();
    });

    expect(mockOpenProject).not.toHaveBeenCalled();
    expect(mockCreateFolder).not.toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error when the target project name already exists', async () => {
    mockCheckFileExists.mockImplementation(async (path: string) => {
      return path === '/projects/demo/project.json';
    });

    const onClose = jest.fn();
    render(<NewProjectDialog isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'demo' },
    });
    await pickFolder('/projects');

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'A project named "demo" already exists in the selected location.',
        ),
      ).not.toBeNull();
    });

    expect(mockOpenProject).not.toHaveBeenCalled();
    expect(mockCreateFolder).not.toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows unsigned users to create projects in local mode', async () => {
    mockCheckFileExists.mockResolvedValue(false);

    const onClose = jest.fn();
    render(<NewProjectDialog isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'demo' },
    });
    await pickFolder('/projects');

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        '/projects/demo',
        'demo',
        undefined,
      );
    });
    expect(mockOpenProject).toHaveBeenCalledWith('/projects/demo');
    expect(onClose).toHaveBeenCalled();
  });

  it('creates a project without any provider sign-in gate', async () => {
    mockCheckFileExists.mockResolvedValue(false);

    const onClose = jest.fn();
    render(<NewProjectDialog isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'demo' },
    });
    await pickFolder('/projects');

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        '/projects/demo',
        'demo',
        undefined,
      );
    });
    expect(mockOpenProject).toHaveBeenCalledWith('/projects/demo');
    expect(onClose).toHaveBeenCalled();
  });

  it('creates a new project when no existing project is found', async () => {
    mockCheckFileExists.mockResolvedValue(false);

    const onClose = jest.fn();
    render(<NewProjectDialog isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByLabelText('Project description'), {
      target: { value: 'A test project' },
    });
    await pickFolder('/projects');

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('/projects', 'demo', {
        source: 'renderer',
        intent: 'new_project_parent',
      });
    });
    expect(mockCreateProject).toHaveBeenCalledWith(
      '/projects/demo',
      'demo',
      'A test project',
    );
    expect(mockOpenProject).toHaveBeenCalledWith('/projects/demo');
    expect(mockCloseProject).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('resets the created project state when opening the new folder fails', async () => {
    mockCheckFileExists.mockResolvedValue(false);
    mockOpenProject.mockRejectedValue(new Error('Unable to attach project'));

    const onClose = jest.fn();
    render(<NewProjectDialog isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'demo' },
    });
    await pickFolder('/projects');

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(screen.getByText('Unable to attach project')).not.toBeNull();
    });

    expect(mockCreateProject).toHaveBeenCalledWith(
      '/projects/demo',
      'demo',
      undefined,
    );
    expect(mockOpenProject).toHaveBeenCalledWith('/projects/demo');
    expect(mockCloseProject).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
