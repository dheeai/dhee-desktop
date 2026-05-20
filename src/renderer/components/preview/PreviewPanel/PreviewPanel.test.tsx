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
import { render, screen } from '@testing-library/react';
import PreviewPanel from './PreviewPanel';

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
  TimelineDataProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// View components are stubbed — the test is about the tab bar, not
// the contents. Keeping the stubs as named null components avoids
// pulling their full dependency trees (electron file APIs, charts,
// CodeMirror, etc.) into the jsdom test runtime.
jest.mock('../AssetsView/AssetsView', () => () => null);
jest.mock('../StoryboardView/StoryboardView', () => () => null);
jest.mock('../PromptsView/PromptsView', () => () => null);
jest.mock('../VideoLibraryView/VideoLibraryView', () => () => null);
jest.mock('../PlansView/PlansView', () => () => null);
jest.mock('../TimelinePanel/TimelinePanel', () => () => null);
jest.mock('../EditorIcons', () => ({ TimelineDockIcon: () => null }));
// RedoFromMenu uses useDheeSession which needs the full
// window.dhee IPC surface. Stubbed for the tab-bar tests; the menu
// has its own test file (RedoFromMenu/redoFromStages.test.ts) for
// the data layer.
jest.mock('../RedoFromMenu/RedoFromMenu', () => () => null);

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
        expect(
          screen.queryByRole('tab', { name: /Storyboard/i }),
        ).toBeNull();
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
    });
  });
});
