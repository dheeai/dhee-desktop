/**
 * Tab visibility + ordering for the workspace preview panel.
 *
 * Spec (2026-05-06): the project's primary surface is the per-shot
 * Prompts view — every other tab is secondary. Storyboard and Assets
 * are deprecated (kept in source so we can re-enable later, but hidden
 * from the user). Library moves to the second slot, behind Prompts.
 *
 * GIVEN-WHEN-THEN structure pins the visible-tab contract from the
 * user's perspective: which tab labels appear, in which order, and
 * which is the default selection. Tests exercise the actual rendered
 * component (per CLAUDE.md "exercise behavior, not source text") with
 * the heavy view children stubbed so the assertion is about the tab
 * bar itself.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import PreviewPanel from './PreviewPanel';

type AnimationFrameCallback = (timestamp: number) => void;

let mockTimelineTotalDuration = 5;
let mockFrameCallbacks: AnimationFrameCallback[] = [];

const mockTimelinePanel = jest.fn(
  ({
    playbackTime,
    isPlaying,
    onPlayPause,
  }: {
    playbackTime: number;
    isPlaying: boolean;
    onPlayPause?: (playing: boolean) => void;
  }) => (
    <div data-testid="timeline-panel">
      <button type="button" onClick={() => onPlayPause?.(!isPlaying)}>
        Timeline Play Toggle
      </button>
      <span data-testid="timeline-playback-time">
        {playbackTime.toFixed(2)}
      </span>
      <span data-testid="timeline-playing-state">{String(isPlaying)}</span>
    </div>
  ),
);

const mockVideoLibraryView = jest.fn(() => (
  <div data-testid="watch-view">Watch</div>
));

function flushAnimationFrame(timestamp: number) {
  const callbacks = mockFrameCallbacks;
  mockFrameCallbacks = [];
  callbacks.forEach((callback) => callback(timestamp));
}

jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    projectDirectory: '/tmp/fake-project',
    pendingFileNavigation: null,
    clearFileNavigation: () => {},
  }),
}));

jest.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({
    timelineState: null,
    scenes: [],
  }),
}));

jest.mock('../../../contexts/TimelineDataContext', () => ({
  TimelineDataProvider: ({ children }: { children: ReactNode }) => children,
  useTimelineDataContext: () => ({
    totalDuration: mockTimelineTotalDuration,
  }),
}));

// View components are stubbed — the test is about the tab bar, not
// the contents. Keeping the stubs as named null components avoids
// pulling their full dependency trees (electron file APIs, charts,
// CodeMirror, etc.) into the jsdom test runtime.
jest.mock('../AssetsView/AssetsView', () => () => null);
jest.mock('../StoryboardView/StoryboardView', () => () => null);
jest.mock('../PromptsView/PromptsView', () => () => null);
jest.mock(
  '../VideoLibraryView/VideoLibraryView',
  () => () => mockVideoLibraryView(),
);
jest.mock('../PlansView/PlansView', () => () => null);
jest.mock(
  '../TimelinePanel/TimelinePanel',
  () => (props: Parameters<typeof mockTimelinePanel>[0]) =>
    mockTimelinePanel(props),
);
jest.mock('../EditorIcons', () => ({ TimelineDockIcon: () => null }));
// RedoFromMenu uses useDheeSession which needs the full
// window.dhee IPC surface. Stubbed for the tab-bar tests; the menu
// has its own test file (RedoFromMenu/redoFromStages.test.ts) for
// the data layer.
jest.mock('../RedoFromMenu/RedoFromMenu', () => () => null);

beforeEach(() => {
  mockTimelineTotalDuration = 5;
  mockFrameCallbacks = [];
  mockTimelinePanel.mockClear();
  mockVideoLibraryView.mockClear();
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: jest.fn((callback: AnimationFrameCallback) => {
      mockFrameCallbacks.push(callback);
      return mockFrameCallbacks.length;
    }),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: jest.fn(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PreviewPanel — tab visibility and default selection', () => {
  describe('GIVEN a project is open', () => {
    describe('WHEN the workspace tab bar renders', () => {
      it('THEN Prompts is the first tab', () => {
        render(<PreviewPanel />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs[0]).toHaveTextContent(/^Prompts$/);
      });

      it('THEN Watch is the second tab', () => {
        render(<PreviewPanel />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs[1]).toHaveTextContent(/^Watch$/);
      });

      it('THEN Storyboard is NOT visible', () => {
        render(<PreviewPanel />);
        expect(screen.queryByRole('tab', { name: /Storyboard/i })).toBeNull();
      });

      it('THEN Assets is NOT visible', () => {
        render(<PreviewPanel />);
        expect(screen.queryByRole('tab', { name: /^Assets$/i })).toBeNull();
      });

      it('THEN Content is the third tab (renamed from Files)', () => {
        render(<PreviewPanel />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs[2]).toHaveTextContent(/^Content$/);
      });

      it('THEN the deprecated "Files" label is no longer present', () => {
        render(<PreviewPanel />);
        expect(screen.queryByRole('tab', { name: /^Files$/ })).toBeNull();
      });

      it('THEN Prompts is the active (default) tab', () => {
        render(<PreviewPanel />);
        const promptsTab = screen.getByRole('tab', { name: /^Prompts$/ });
        expect(promptsTab).toHaveAttribute('aria-selected', 'true');
      });

      it('THEN the timeline play button advances playback on the default Prompts tab', async () => {
        render(<PreviewPanel />);

        fireEvent.click(
          screen.getByRole('button', { name: 'Timeline Play Toggle' }),
        );

        await waitFor(() => {
          expect(mockFrameCallbacks.length).toBeGreaterThan(0);
        });

        act(() => {
          flushAnimationFrame(1000);
          flushAnimationFrame(1500);
        });

        await waitFor(() => {
          expect(
            Number(screen.getByTestId('timeline-playback-time').textContent),
          ).toBeGreaterThan(0);
        });
      });

      it('THEN the fallback clock stays disabled while Watch is active', async () => {
        render(<PreviewPanel />);

        fireEvent.click(screen.getByRole('tab', { name: /^Watch$/ }));
        fireEvent.click(
          screen.getByRole('button', { name: 'Timeline Play Toggle' }),
        );

        await waitFor(() => {
          expect(
            screen.getByTestId('timeline-playing-state'),
          ).toHaveTextContent('true');
        });

        expect(mockFrameCallbacks).toHaveLength(0);
        expect(screen.getByTestId('timeline-playback-time')).toHaveTextContent(
          '0.00',
        );
      });
    });
  });
});
