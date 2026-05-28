/**
 * WorkspaceLayout — binary-workspace shape.
 *
 * Per the 2026-05-28 architectural pivot the workspace is exactly:
 *   - StatusStrip across the top
 *   - InspectorView on the left
 *   - ChatPanel on the right (collapsible)
 *   - OverlayHost above all (renders nothing unless an overlay is open)
 *
 * The legacy PreviewPanel (tab system) is gone — no Inspector/Watch/
 * Content tabs, no Timeline dock at the bottom, no StatusBar footer.
 * Watch/Plans/Timeline/Settings live as overlays now.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

// react-resizable-panels ships ESM-only; jest's CJS transform can't
// handle it. Stub with passthrough divs — the test asserts on the
// children mounting, not on the resize behavior.
jest.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: () => null,
}));

import WorkspaceLayout from './WorkspaceLayout';

jest.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    closeProject: jest.fn(),
    projectName: 'Ruby V4',
    projectDirectory: '/tmp/Ruby V4',
    pendingFileNavigation: null,
    clearFileNavigation: () => {},
  }),
}));

jest.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({
    bundle: null,
    timelineState: null,
    scenes: [],
  }),
}));

jest.mock('../../../hooks/useRunnerStatus', () => ({
  useRunnerStatus: () => ({
    status: null,
    active: false,
    cancelling: false,
    cancel: jest.fn(),
  }),
}));

jest.mock('../../../inspector/InspectorView', () => ({
  InspectorView: () => <div data-testid="ws-inspector">inspector</div>,
}));

jest.mock('../../chat/ChatPanelEmbedded/ChatPanelEmbedded', () => ({
  __esModule: true,
  default: () => <div data-testid="ws-chat">chat</div>,
}));

describe('WorkspaceLayout — binary workspace', () => {
  it('renders the StatusStrip across the top', () => {
    render(<WorkspaceLayout />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders the InspectorView (canvas, left)', () => {
    render(<WorkspaceLayout />);
    expect(screen.getByTestId('ws-inspector')).toBeInTheDocument();
  });

  it('renders the ChatPanel (right)', () => {
    render(<WorkspaceLayout />);
    expect(screen.getByTestId('ws-chat')).toBeInTheDocument();
  });

  it('does NOT render the legacy PreviewPanel tab system', () => {
    render(<WorkspaceLayout />);
    // The PreviewPanel tab bar exposed role=tablist; the binary
    // workspace has no tabs.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('does NOT render the legacy StatusBar footer', () => {
    // The footer was a known landmark with `contentinfo` role from
    // the <footer> semantic in StatusBar.tsx. The binary workspace
    // folds its info into the StatusStrip across the top.
    render(<WorkspaceLayout />);
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });

  it('shows the project name in the StatusStrip', () => {
    render(<WorkspaceLayout />);
    expect(screen.getByText('Ruby V4')).toBeInTheDocument();
  });

  it('exposes the Back button (StatusStrip)', () => {
    render(<WorkspaceLayout />);
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('mounts the OverlayHost so overlays can open over the workspace', () => {
    // The host renders only when an overlay is open; verify the
    // provider wires up by checking that the layout doesn't throw
    // on mount (a useOverlay() consumer outside a provider throws).
    expect(() => render(<WorkspaceLayout />)).not.toThrow();
  });
});
