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
  const checkBundleReadiness =
    jest.fn<(payload: unknown) => Promise<unknown>>();
  const updateSettings = jest.fn<(payload: unknown) => Promise<unknown>>();
  const initialize =
    jest.fn<(payload: unknown) => Promise<{ ok: true; projectDir: string }>>();
  const createFolder = jest.fn<() => Promise<string | null>>();

  beforeEach(() => {
    mockOpenProject.mockReset();
    listBundles.mockReset();
    installBundlePackage.mockReset();
    checkBundleReadiness.mockReset();
    updateSettings.mockReset();
    initialize.mockReset();
    createFolder.mockReset();

    mockOpenProject.mockResolvedValue(undefined);
    checkBundleReadiness.mockResolvedValue({
      ok: true,
      requiredRunners: [],
      installedRunners: [],
      missingRunners: [],
      versionMismatches: [],
      requiredCredentials: [],
      missingCredentials: [],
      errors: [],
    });
    updateSettings.mockResolvedValue({ runnerCredentials: {} });
    createFolder.mockResolvedValue('/projects/my-short');
    initialize.mockResolvedValue({
      ok: true,
      projectDir: '/projects/my-short',
    });

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        project: {
          listBundles,
          installBundlePackage,
          checkBundleReadiness,
          getDefaultWorkspacePath: async () => '/projects',
          getRecent: async () => [],
          selectDirectory: async () => '/projects',
          createFolder,
          initialize,
        },
        settings: {
          update: updateSettings,
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
      runnerDirs: [],
      runners: [],
      readiness: {
        ok: true,
        requiredRunners: [],
        installedRunners: [],
        missingRunners: [],
        versionMismatches: [],
        requiredCredentials: [],
        missingCredentials: [],
        errors: [],
      },
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
    await waitFor(() =>
      expect(checkBundleReadiness).toHaveBeenCalledWith({
        bundleSource: 'user:youtube_short_text_video',
      }),
    );
    const rollButton = screen.getByRole('button', { name: /^roll/i });
    await waitFor(() =>
      expect((rollButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(rollButton);

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

  it('blocks ROLL until missing OpenRouter runner credentials are saved', async () => {
    listBundles.mockResolvedValue([youtubeBundle]);
    checkBundleReadiness
      .mockResolvedValueOnce({
        ok: false,
        bundleId: 'youtube_short_text_video',
        bundleSource: 'user:youtube_short_text_video',
        requiredRunners: [
          {
            tool: 'openrouter.image',
            range: '>=0.1.0',
            installed: true,
            version: '0.1.0',
            versionSatisfied: true,
            credentials: ['OPENROUTER_API_KEY'],
            missingCredentials: ['OPENROUTER_API_KEY'],
          },
        ],
        installedRunners: [],
        missingRunners: [],
        versionMismatches: [],
        requiredCredentials: ['OPENROUTER_API_KEY'],
        missingCredentials: ['OPENROUTER_API_KEY'],
        errors: ["Required runner credential 'OPENROUTER_API_KEY' is missing."],
      })
      .mockResolvedValueOnce({
        ok: true,
        bundleId: 'youtube_short_text_video',
        bundleSource: 'user:youtube_short_text_video',
        requiredRunners: [
          {
            tool: 'openrouter.image',
            range: '>=0.1.0',
            installed: true,
            version: '0.1.0',
            versionSatisfied: true,
            credentials: ['OPENROUTER_API_KEY'],
            missingCredentials: [],
          },
        ],
        installedRunners: [],
        missingRunners: [],
        versionMismatches: [],
        requiredCredentials: ['OPENROUTER_API_KEY'],
        missingCredentials: [],
        errors: [],
      });

    render(<NewProjectScreen isOpen onClose={jest.fn()} />);

    await waitFor(() => screen.getByText('YouTube Short'));
    fireEvent.click(screen.getByText('YouTube Short'));
    fireEvent.change(screen.getByPlaceholderText('Short idea...'), {
      target: { value: 'A creator learns why the first three seconds matter.' },
    });
    await waitFor(() =>
      screen.getByPlaceholderText('Enter OPENROUTER_API_KEY'),
    );

    const blockedRollButton = screen.getByRole('button', { name: /^roll/i });
    fireEvent.click(blockedRollButton);
    expect(initialize).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Enter OPENROUTER_API_KEY'), {
      target: { value: 'or-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save credentials/i }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        runnerCredentials: { OPENROUTER_API_KEY: 'or-secret' },
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Required runners:/i)).not.toBeNull(),
    );
    expect(
      screen.getByText('Credentials configured: OPENROUTER_API_KEY'),
    ).not.toBeNull();
    expect(
      screen.queryByPlaceholderText('Enter OPENROUTER_API_KEY'),
    ).toBeNull();

    const readyRollButton = screen.getByRole('button', { name: /^roll/i });
    await waitFor(() =>
      expect((readyRollButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(readyRollButton);
    await waitFor(() => expect(initialize).toHaveBeenCalled());
  });

  it('shows configured credential names without password inputs when ready', async () => {
    listBundles.mockResolvedValue([youtubeBundle]);
    checkBundleReadiness.mockResolvedValue({
      ok: true,
      bundleId: 'youtube_short_text_video',
      bundleSource: 'user:youtube_short_text_video',
      requiredRunners: [
        {
          tool: 'openrouter.video',
          range: '>=0.1.0',
          installed: true,
          version: '0.1.0',
          versionSatisfied: true,
          credentials: ['OPENROUTER_API_KEY'],
          missingCredentials: [],
        },
      ],
      installedRunners: [],
      missingRunners: [],
      versionMismatches: [],
      requiredCredentials: ['OPENROUTER_API_KEY'],
      missingCredentials: [],
      errors: [],
    });

    render(<NewProjectScreen isOpen onClose={jest.fn()} />);

    await waitFor(() => screen.getByText('YouTube Short'));
    fireEvent.click(screen.getByText('YouTube Short'));

    await waitFor(() =>
      expect(
        screen.getByText('Credentials configured: OPENROUTER_API_KEY'),
      ).not.toBeNull(),
    );
    expect(
      screen.queryByPlaceholderText('Enter OPENROUTER_API_KEY'),
    ).toBeNull();
  });
});
