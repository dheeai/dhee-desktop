import '@testing-library/jest-dom';
import { act, render } from '@testing-library/react';
jest.mock('react', () => jest.requireActual('react'));
jest.mock('../renderer/components/layout/WorkspaceLayout/WorkspaceLayout', () => () => null);
jest.mock('../renderer/components/landing/LandingScreen/LandingScreen', () => () => null);
import App from '../renderer/App';

describe('App', () => {
  it('should render', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        settings: {
          get: jest.fn().mockResolvedValue({
            comfyuiMode: 'inherit',
            comfyuiUrl: '',
            comfyCloudApiKey: '',
            comfyuiTimeout: 1800,
            llmProvider: 'lmstudio',
            lmStudioUrl: 'http://127.0.0.1:1234',
            lmStudioModel: 'qwen3',
            googleApiKey: '',
            geminiModel: 'gemini-2.5-flash',
            openaiApiKey: '',
            openaiBaseUrl: 'https://api.openai.com/v1',
            openaiModel: 'gpt-4o',
            openRouterApiKey: '',
            openRouterModel: 'z-ai/glm-4.7-flash',
            themeId: 'studio-neutral',
          }),
          update: jest.fn(),
          onChange: jest.fn(() => jest.fn()),
        },
        project: {
          watchDirectory: jest.fn().mockResolvedValue(undefined),
          getRecentProjects: jest.fn().mockResolvedValue([]),
        },
        app: {
          getVersion: jest.fn().mockResolvedValue('1.0.9'),
        },
        ipcRenderer: {
          once: jest.fn(),
          sendMessage: jest.fn(),
        },
      },
    });

    let rendered: ReturnType<typeof render> | null = null;

    await act(async () => {
      rendered = render(<App />);
    });

    expect(rendered).toBeTruthy();
  });
});
