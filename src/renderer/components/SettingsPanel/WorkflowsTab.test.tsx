import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkflowsTab from './WorkflowsTab';

type WorkflowsBridge = {
  list: jest.Mock;
  get: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  validate: jest.Mock;
};

function installBridge(bridge: Partial<WorkflowsBridge>): WorkflowsBridge {
  const full: WorkflowsBridge = {
    list: bridge.list ?? jest.fn(async () => ({ ok: true, workflows: [] })),
    get: bridge.get ?? jest.fn(async () => ({ ok: false, error: 'not stubbed' })),
    update: bridge.update ?? jest.fn(async () => ({ ok: true, manifest: {} })),
    delete: bridge.delete ?? jest.fn(async () => ({ ok: true })),
    validate: bridge.validate ?? jest.fn(async () => ({ ok: true, valid: true })),
  };
  Object.defineProperty(window, 'kshana', {
    configurable: true,
    value: { workflows: full },
  });
  return full;
}

const userWorkflow = {
  id: 'my_anime',
  displayName: 'My Anime',
  pipeline: 'image_generation',
  builtIn: false,
  isOverride: false,
  active: true,
};

const builtIn = {
  id: 'i2v',
  displayName: 'Image to Video',
  pipeline: 'video_generation',
  builtIn: true,
  isOverride: false,
  active: true,
};

describe('WorkflowsTab', () => {
  afterEach(() => {
    Object.defineProperty(window, 'kshana', { configurable: true, value: undefined });
  });

  it('shows the empty state when there are no user workflows', async () => {
    installBridge({ list: jest.fn(async () => ({ ok: true, workflows: [builtIn] })) });
    await act(async () => {
      render(<WorkflowsTab />);
    });
    await waitFor(() =>
      expect(screen.getByText(/No custom workflows yet/i)).toBeInTheDocument(),
    );
    // The built-in is still visible under its group.
    expect(screen.getByText('Image to Video')).toBeInTheDocument();
  });

  it('renders user workflows with edit, delete, and set active buttons', async () => {
    installBridge({
      list: jest.fn(async () => ({ ok: true, workflows: [userWorkflow, builtIn] })),
    });
    await act(async () => {
      render(<WorkflowsTab />);
    });
    await waitFor(() => expect(screen.getByText('My Anime')).toBeInTheDocument());
    expect(screen.getByLabelText('Edit My Anime')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete My Anime')).toBeInTheDocument();
    expect(screen.getByText('Set active')).toBeInTheDocument();
  });

  it('hides the Set active button on a workflow that is already active for its pipeline', async () => {
    installBridge({
      list: jest.fn(async () => ({
        ok: true,
        workflows: [{ ...userWorkflow, isOverride: true }],
      })),
    });
    await act(async () => {
      render(<WorkflowsTab />);
    });
    await waitFor(() => expect(screen.getByText('My Anime')).toBeInTheDocument());
    expect(screen.queryByText('Set active')).not.toBeInTheDocument();
  });

  it('calls update with isOverride=true when Set active is clicked', async () => {
    const update = jest.fn(async () => ({ ok: true, manifest: {} }));
    installBridge({
      list: jest.fn(async () => ({ ok: true, workflows: [userWorkflow] })),
      update,
    });
    await act(async () => {
      render(<WorkflowsTab />);
    });
    await waitFor(() => expect(screen.getByText('Set active')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText('Set active'));
    });
    expect(update).toHaveBeenCalledWith({
      id: 'my_anime',
      patch: { isOverride: true },
    });
  });

  it('calls delete with the workflow id when the user confirms', async () => {
    const del = jest.fn(async () => ({ ok: true }));
    const list = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, workflows: [userWorkflow] })
      .mockResolvedValueOnce({ ok: true, workflows: [] });
    installBridge({ list, delete: del });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    await act(async () => {
      render(<WorkflowsTab />);
    });
    await waitFor(() => expect(screen.getByText('My Anime')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Delete My Anime'));
    });
    expect(del).toHaveBeenCalledWith({ id: 'my_anime' });

    confirmSpy.mockRestore();
  });

  it('does not call delete when the user cancels the confirm dialog', async () => {
    const del = jest.fn(async () => ({ ok: true }));
    installBridge({
      list: jest.fn(async () => ({ ok: true, workflows: [userWorkflow] })),
      delete: del,
    });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    await act(async () => {
      render(<WorkflowsTab />);
    });
    await waitFor(() => expect(screen.getByText('My Anime')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Delete My Anime'));
    });
    expect(del).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('shows the add-workflow hint pointing the user to the chat', async () => {
    installBridge({});
    await act(async () => {
      render(<WorkflowsTab />);
    });
    // No button — the chat is the canonical install path. The tab
    // tells the user how to start instead.
    expect(
      screen.queryByRole('button', { name: /add workflow/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/To add a custom workflow, open any project/i),
    ).toBeInTheDocument();
  });

  it('shows an error when the list IPC fails', async () => {
    installBridge({
      list: jest.fn(async () => ({ ok: false, error: 'IPC fail' })),
    });
    await act(async () => {
      render(<WorkflowsTab />);
    });
    await waitFor(() => expect(screen.getByText('IPC fail')).toBeInTheDocument());
  });

  it('renders an "inactive" badge when a workflow is filtered out by the current mode', async () => {
    installBridge({
      list: jest.fn(async () => ({
        ok: true,
        workflows: [{ ...userWorkflow, active: false }],
      })),
    });
    await act(async () => {
      render(<WorkflowsTab isCloudMode />);
    });
    await waitFor(() => expect(screen.getByText('My Anime')).toBeInTheDocument());
    expect(screen.getByText('inactive')).toBeInTheDocument();
    // Set-active button is hidden for inactive workflows — switching
    // mode is the only way to reactivate.
    expect(screen.queryByText('Set active')).not.toBeInTheDocument();
  });

  it('renders a cloud-mode banner when isCloudMode=true', async () => {
    installBridge({});
    await act(async () => {
      render(<WorkflowsTab isCloudMode />);
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Custom workflows only run on local ComfyUI/i),
      ).toBeInTheDocument(),
    );
  });

  it('does not render the cloud-mode banner in local mode', async () => {
    installBridge({});
    await act(async () => {
      render(<WorkflowsTab />);
    });
    expect(
      screen.queryByText(/Custom workflows only run on local ComfyUI/i),
    ).not.toBeInTheDocument();
  });

  it('opens the inline editor with the manifest values when Edit is clicked', async () => {
    const get = jest.fn(async () => ({
      ok: true,
      manifest: {
        displayName: 'My Anime',
        parameterMappings: [
          { input: 'prompt', nodeId: '5', field: 'text', defaultValue: 'a cat' },
          { input: 'seed', nodeId: '9', field: 'seed', defaultValue: 42 },
        ],
      },
    }));
    installBridge({
      list: jest.fn(async () => ({ ok: true, workflows: [userWorkflow] })),
      get,
    });
    await act(async () => {
      render(<WorkflowsTab />);
    });
    await waitFor(() => expect(screen.getByText('My Anime')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Edit My Anime'));
    });
    await waitFor(() => expect(get).toHaveBeenCalledWith({ id: 'my_anime' }));
    // Editor inputs render the parameter table values.
    await waitFor(() =>
      expect(screen.getByDisplayValue('a cat')).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('42')).toBeInTheDocument();
  });
});
