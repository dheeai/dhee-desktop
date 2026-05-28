/**
 * Inspector tab appears in the PreviewPanel tab bar.
 *
 * Per Phase 2 of the Inspector Canvas plan: ship as a NEW tab beside
 * the existing ones — old tabs (Prompts/Storyboard/Assets) stay until
 * Inspector is proven. The Phase 5 cleanup deletes the legacy tabs.
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

jest.mock('../AssetsView/AssetsView', () => () => null);
jest.mock('../StoryboardView/StoryboardView', () => () => null);
jest.mock('../PromptsView/PromptsView', () => () => null);
jest.mock('../VideoLibraryView/VideoLibraryView', () => () => null);
jest.mock('../PlansView/PlansView', () => () => null);
jest.mock('../TimelinePanel/TimelinePanel', () => () => null);
jest.mock('../EditorIcons', () => ({ TimelineDockIcon: () => null }));
jest.mock('../RedoFromMenu/RedoFromMenu', () => () => null);
// Inspector mount is stubbed for the tab-bar test — its own scaffold
// test exercises mount behavior.
jest.mock('../../../inspector/InspectorView', () => ({
  InspectorView: () => null,
}));

describe('PreviewPanel — Inspector tab (Phase 2)', () => {
  it('shows Inspector as a tab', () => {
    render(<PreviewPanel />);
    expect(screen.getByRole('tab', { name: /^Inspector$/ })).toBeInTheDocument();
  });

  it('Inspector is the first tab (primary surface)', () => {
    // The Inspector Canvas IS the project workspace post-migration.
    // Even with Prompts/Storyboard/Assets still in the visible tabs
    // for the transitional release, Inspector goes first so it's the
    // default tab.
    render(<PreviewPanel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent(/^Inspector$/);
  });

  it('Inspector is the default active tab', () => {
    render(<PreviewPanel />);
    const inspector = screen.getByRole('tab', { name: /^Inspector$/ });
    expect(inspector).toHaveAttribute('aria-selected', 'true');
  });
});
