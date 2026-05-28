/**
 * Tab visibility + ordering for the workspace preview panel.
 *
 * Spec (2026-05-28, Phase 5): the Inspector Canvas is now the only
 * inspection surface. PromptsView / StoryboardView / AssetsView were
 * deleted — the Inspector renders every artifact kind in-place via
 * the bundle DAG, so the per-artifact-type tabs are obsolete. Watch
 * (VideoLibraryView) and Content (PlansView) remain.
 *
 * GIVEN-WHEN-THEN structure pins the visible-tab contract from the
 * user's perspective: which tab labels appear, in which order, and
 * which is the default selection.
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
    bundle: null,
  }),
}));

jest.mock('../../../contexts/TimelineDataContext', () => ({
  TimelineDataProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../VideoLibraryView/VideoLibraryView', () => () => null);
jest.mock('../PlansView/PlansView', () => () => null);
jest.mock('../TimelinePanel/TimelinePanel', () => () => null);
jest.mock('../EditorIcons', () => ({ TimelineDockIcon: () => null }));
// RedoFromMenu uses useDheeSession which needs the full
// window.dhee IPC surface. Stubbed for the tab-bar tests.
jest.mock('../RedoFromMenu/RedoFromMenu', () => () => null);
jest.mock('../../../inspector/InspectorView', () => ({
  InspectorView: () => null,
}));

describe('PreviewPanel — tab visibility and default selection', () => {
  describe('GIVEN a project is open', () => {
    describe('WHEN the workspace tab bar renders', () => {
      it('THEN Inspector is the first tab', () => {
        render(<PreviewPanel />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs[0]).toHaveTextContent(/^Inspector$/);
      });

      it('THEN Watch is the second tab', () => {
        render(<PreviewPanel />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs[1]).toHaveTextContent(/^Watch$/);
      });

      it('THEN Content is the third tab', () => {
        render(<PreviewPanel />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs[2]).toHaveTextContent(/^Content$/);
      });

      it('THEN exactly three tabs are visible', () => {
        render(<PreviewPanel />);
        expect(screen.getAllByRole('tab')).toHaveLength(3);
      });

      it('THEN Prompts is NOT visible (deleted in Phase 5)', () => {
        render(<PreviewPanel />);
        expect(screen.queryByRole('tab', { name: /^Prompts$/ })).toBeNull();
      });

      it('THEN Storyboard is NOT visible', () => {
        render(<PreviewPanel />);
        expect(screen.queryByRole('tab', { name: /Storyboard/i })).toBeNull();
      });

      it('THEN Assets is NOT visible', () => {
        render(<PreviewPanel />);
        expect(screen.queryByRole('tab', { name: /^Assets$/i })).toBeNull();
      });

      it('THEN the deprecated "Files" label is no longer present', () => {
        render(<PreviewPanel />);
        expect(screen.queryByRole('tab', { name: /^Files$/ })).toBeNull();
      });

      it('THEN Inspector is the active (default) tab', () => {
        render(<PreviewPanel />);
        const inspector = screen.getByRole('tab', { name: /^Inspector$/ });
        expect(inspector).toHaveAttribute('aria-selected', 'true');
      });
    });
  });
});
