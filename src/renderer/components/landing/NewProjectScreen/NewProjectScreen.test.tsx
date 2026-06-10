import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewProjectScreen from './NewProjectScreen';

const mockOpenProject = jest.fn<(path: string) => Promise<void>>();

jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    openProject: mockOpenProject,
  }),
}));

const youtubeBundle = {
  id: 'youtube_short_text_video',
  version: '0.1.0',
  bundleSource: 'user:youtube_short_text_video',
  sourceScheme: 'user',
  displayName: 'YouTube Short',
  summary: 'Short-form vertical video.',
  pickerEligible: true,
  inputs: [
    {
      id: 'story_input',
      kind: 'file',
      path: 'inputs/story.md',
      required: true,
      placeholder: 'Short idea...',
    },
    {
      id: 'targetDuration',
      kind: 'project',
      field: 'targetDuration',
      default: 30,
      label: 'Duration',
      control: 'pills',
      options: [{ value: 30, label: '30s' }],
    },
  ],
};

describe('NewProjectScreen bundle packages', () => {
  const listBundles = jest.fn<() => Promise<unknown[]>>();
  const installBundlePackage =
    jest.fn<(payload: unknown) => Promise<unknown>>();
  const initialize =
    jest.fn<(payload: unknown) => Promise<{ ok: true; projectDir: string }>>();
  const createFolder = jest.fn<() => Promise<string | null>>();

  beforeEach(() => {
    mockOpenProject.mockReset();
    listBundles.mockReset();
    installBundlePackage.mockReset();
    initialize.mockReset();
    createFolder.mockReset();

    mockOpenProject.mockResolvedValue(undefined);
    createFolder.mockResolvedValue('/projects/my-short');
    initialize.mockResolvedValue({
      ok: true,
      projectDir: '/projects/my-short',
    });

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        settings: {
          get: async () => ({ comfyuiMode: 'local', comfyuiUrl: '' }),
        },
        bundleConfig: {
          check: async () => ({ error: 'ComfyUI not connected in test' }),
          resolution: async () => null,
        },
        project: {
          listBundles,
          installBundlePackage,
          getDefaultWorkspacePath: async () => '/projects',
          getRecent: async () => [],
          selectDirectory: async () => '/projects',
          createFolder,
          initialize,
        },
      },
    });
  });

  it('installs an npm bundle and refreshes the picker', async () => {
    listBundles.mockResolvedValueOnce([]);
    listBundles.mockResolvedValueOnce([youtubeBundle]);
    installBundlePackage.mockResolvedValue({
      ok: true,
      packageName: '@dhee_ai/youtube-short-bundle',
      version: '0.1.0',
      bundleId: 'youtube_short_text_video',
      bundleDir: '/projects/bundles/youtube_short_text_video',
    });

    render(<NewProjectScreen isOpen onClose={jest.fn()} />);

    await waitFor(() => expect(listBundles).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /install bundle/i }));

    await waitFor(() =>
      expect(screen.getByText('YouTube Short')).not.toBeNull(),
    );
    expect(installBundlePackage).toHaveBeenCalledWith({
      packageSpec: '@dhee_ai/youtube-short-bundle',
    });
  });

  it('passes user bundleSource into project initialization', async () => {
    listBundles.mockResolvedValue([youtubeBundle]);

    render(<NewProjectScreen isOpen onClose={jest.fn()} />);

    await waitFor(() => screen.getByText('YouTube Short'));
    fireEvent.click(screen.getByText('YouTube Short'));
    fireEvent.change(screen.getByPlaceholderText('Short idea...'), {
      target: { value: 'A creator learns why the first three seconds matter.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^roll/i }));

    await waitFor(() => {
      expect(initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          bundleId: 'youtube_short_text_video',
          bundleSource: 'user:youtube_short_text_video',
          inputs: expect.objectContaining({
            story_input: 'A creator learns why the first three seconds matter.',
          }),
        }),
      );
    });
  });
});
