/**
 * StatusStrip — the only persistent top-edge UI in the binary workspace.
 *
 * Layout (left → right):
 *   ← Back   Project · Bundle   |   ACTIVITY chip   |   overlay launchers   ⚙
 *
 * The center is now a compact, HONEST activity chip reflecting the walk
 * runner OR the agent working a turn ("Idle" / "Working" / "Running" /
 * "Stopping…"). The detailed run readout (task kind, elapsed, Stop) moved
 * to the TransportBar — those are covered by TransportBar's own tests.
 *
 * Tests pin: project label, the honest activity chip across runner/agent
 * states, overlay launchers, back, badges.
 */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
// Mock BackendBadges to avoid pulling AppSettings + account IPC into
// the StatusStrip unit tests. The badge component has its own tests.
jest.mock('../../backend/BackendBadges', () => ({
  __esModule: true,
  default: () => <div data-testid="backend-badges-stub" />,
}));

// The strip now reads useDheeSession for the agent-busy half of its honest
// activity chip. Drive it via a mutable mock.
let mockSessionStatus = 'idle';
let mockExecution = {
  active: false,
  runnerActive: false,
  chatBusy: false,
  pendingCancel: false,
  otherProjectRunner: null,
  cancel: jest.fn(),
};
jest.mock('../../../hooks/useDheeSession', () => ({
  useDheeSession: () => ({ status: mockSessionStatus, execution: mockExecution }),
  useOptionalDheeSession: () => ({ status: mockSessionStatus, execution: mockExecution }),
}));

import { StatusStrip } from './StatusStrip';
import { OverlayProvider, useOverlay } from '../../../overlays/OverlayContext';

const runnerStatusMock = jest.fn();
const runnerCancelMock = jest.fn();

beforeAll(() => {
  (window as unknown as { dhee: unknown }).dhee = {
    runnerStatus: () => runnerStatusMock(),
    runnerCancel: () => runnerCancelMock(),
  };
});

beforeEach(() => {
  runnerStatusMock.mockReset();
  runnerCancelMock.mockReset();
  runnerStatusMock.mockResolvedValue({ active: false });
  runnerCancelMock.mockResolvedValue({ ok: true });
  mockSessionStatus = 'idle';
  mockExecution = {
    active: false,
    runnerActive: false,
    chatBusy: false,
    pendingCancel: false,
    otherProjectRunner: null,
    cancel: jest.fn(),
  };
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function CurrentOverlay() {
  const { current } = useOverlay();
  return <div data-testid="current-overlay">{current ?? 'none'}</div>;
}

const renderStrip = (props: Parameters<typeof StatusStrip>[0] = {}) =>
  render(
    <OverlayProvider>
      <StatusStrip projectName="Ruby V4" bundleId="narrative_qwen_chain_relay" {...props} />
      <CurrentOverlay />
    </OverlayProvider>,
  );

describe('StatusStrip', () => {
  it('shows the project name and bundle id', () => {
    renderStrip();
    expect(screen.getByText('Ruby V4')).toBeInTheDocument();
    expect(screen.getByText(/narrative_qwen_chain_relay/)).toBeInTheDocument();
  });

  it('renders "Idle" when no runner is active', async () => {
    renderStrip();
    // Let the first poll fire.
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status-state')).toHaveTextContent(/idle/i);
  });

  it('reads "Running" when the walk runner is active', async () => {
    mockExecution = {
      active: true,
      runnerActive: true,
      chatBusy: false,
      pendingCancel: false,
      otherProjectRunner: null,
      cancel: jest.fn(),
    };
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status-state')).toHaveTextContent(/running/i);
    // kind/elapsed/Stop are the TransportBar's job now — not the strip.
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
    expect(screen.queryByText(/compose_video/i)).toBeNull();
  });

  it('reads "Working" when the agent is busy but no walk is running (no more "Idle" lie)', async () => {
    mockSessionStatus = 'running';
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status-state')).toHaveTextContent(/working/i);
  });

  it('shows "Stopping…" when a runner cancel is in flight', async () => {
    mockExecution = {
      active: true,
      runnerActive: true,
      chatBusy: false,
      pendingCancel: true,
      otherProjectRunner: null,
      cancel: jest.fn(),
    };
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status-state')).toHaveTextContent(/stopping/i);
  });

  it('renders overlay launcher buttons and fires the right OverlayKey', async () => {
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    // Settings launcher
    const settingsBtn = screen.getByRole('button', { name: /settings/i });
    await act(async () => { settingsBtn.click(); });
    expect(screen.getByTestId('current-overlay')).toHaveTextContent('settings');
    // Library launcher
    const libraryBtn = screen.getByRole('button', { name: /library/i });
    await act(async () => { libraryBtn.click(); });
    expect(screen.getByTestId('current-overlay')).toHaveTextContent('library');
    // Plans launcher
    const plansBtn = screen.getByRole('button', { name: /plans|content/i });
    await act(async () => { plansBtn.click(); });
    expect(screen.getByTestId('current-overlay')).toHaveTextContent('plans');
    // Timeline launcher
    const timelineBtn = screen.getByRole('button', { name: /timeline/i });
    await act(async () => { timelineBtn.click(); });
    expect(screen.getByTestId('current-overlay')).toHaveTextContent('timeline');
  });

  it('Back button fires onBack when provided', async () => {
    const onBack = jest.fn();
    renderStrip({ onBack });
    const back = screen.getByRole('button', { name: /back/i });
    await act(async () => { back.click(); });
    expect(onBack).toHaveBeenCalled();
  });

  it('renders the backend badges (UX-6) and opens Settings when clicked', async () => {
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    // Badge group mounted
    expect(screen.getByTestId('backend-badges-stub')).toBeInTheDocument();
    // Click the wrapping button → Settings overlay opens
    const wrap = screen.getByRole('button', { name: /engine connection/i });
    await act(async () => { wrap.click(); });
    expect(screen.getByTestId('current-overlay')).toHaveTextContent('settings');
  });

  // Ensure the badge button doesn't clash with the existing Settings
  // launcher icon button or the Back button.
  it('badge button label is distinct from Back and Settings labels', () => {
    renderStrip({ onBack: jest.fn() });
    expect(screen.getByRole('button', { name: /engine connection/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^settings$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to landing/i })).toBeInTheDocument();
  });

  it('hides the Back button when onBack is not provided (e.g. landing)', () => {
    renderStrip({ onBack: undefined });
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
  });
});
