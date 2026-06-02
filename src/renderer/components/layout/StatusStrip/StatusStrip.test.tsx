/**
 * StatusStrip — the only persistent top-edge UI in the binary
 * workspace.
 *
 * Layout (left → right):
 *   ← Back   Project · Bundle   |   RUN STATUS (or idle)   |   overlay launchers   ⚙
 *
 * Tests pin: project label, run-status appearance & elapsed
 * timing, Stop button wiring, idle vs active state, overlay
 * launchers fire the OverlayProvider's open() with the right key.
 */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
// Mock BackendBadges to avoid pulling AppSettings + account IPC into
// the StatusStrip unit tests. The badge component has its own tests.
jest.mock('../../backend/BackendBadges', () => ({
  __esModule: true,
  default: () => <div data-testid="backend-badges-stub" />,
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

  it('renders the running task kind + Stop button when a runner is active', async () => {
    runnerStatusMock.mockResolvedValue({
      active: true,
      kind: 'compose_video',
      taskId: 't1',
      startedAt: Date.now() - 10_000, // 10s ago
    });
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status-state')).toHaveTextContent(/running/i);
    expect(screen.getByText(/compose_video/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('Stop button calls runnerCancel', async () => {
    runnerStatusMock.mockResolvedValue({
      active: true,
      kind: 'render',
      taskId: 't1',
      startedAt: Date.now(),
    });
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    const stop = screen.getByRole('button', { name: /stop/i });
    await act(async () => { stop.click(); });
    expect(runnerCancelMock).toHaveBeenCalled();
  });

  it('shows "Stopping…" when a cancel is in flight', async () => {
    runnerStatusMock.mockResolvedValue({
      active: true,
      cancelling: true,
      kind: 'render',
      taskId: 't1',
      startedAt: Date.now(),
    });
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status-state')).toHaveTextContent(/stopping/i);
  });

  it('shows elapsed time since the run started (mm:ss)', async () => {
    runnerStatusMock.mockResolvedValue({
      active: true,
      kind: 'render',
      taskId: 't1',
      startedAt: Date.now() - 65_000, // 1m 5s ago
    });
    renderStrip();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('status-elapsed')).toHaveTextContent(/01:05|1:05/);
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
