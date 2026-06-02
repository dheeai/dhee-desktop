/**
 * InspectorLegend — small status-color legend chip cluster.
 *
 * Sits in a corner of the canvas so a first-time user can read
 * what red/yellow/green/gray mean without trial-and-error. Color
 * dots come from the same theme tokens the nodes use.
 *
 * UX critique 2026-05-28: "node colors mean status, but a first-
 * time user sees red/green/yellow and has to guess." Fixed here.
 */
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { InspectorLegend } from './InspectorLegend';

describe('InspectorLegend', () => {
  it('renders chips for every status the Inspector surfaces', () => {
    render(<InspectorLegend />);
    expect(screen.getByText(/complete/i)).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it('each chip exposes a status data attribute so CSS can color the dot', () => {
    render(<InspectorLegend />);
    expect(screen.getByTestId('legend-chip-completed')).toHaveAttribute('data-status', 'completed');
    expect(screen.getByTestId('legend-chip-running')).toHaveAttribute('data-status', 'running');
    expect(screen.getByTestId('legend-chip-failed')).toHaveAttribute('data-status', 'failed');
    expect(screen.getByTestId('legend-chip-pending')).toHaveAttribute('data-status', 'pending');
  });

  it('also surfaces the goal-node chip (terracotta accent)', () => {
    render(<InspectorLegend />);
    expect(screen.getByText(/goal/i)).toBeInTheDocument();
    expect(screen.getByTestId('legend-chip-goal')).toBeInTheDocument();
  });

  it('is collapsible — clicking the toggle hides the chips', () => {
    render(<InspectorLegend />);
    const toggle = screen.getByRole('button', { name: /collapse legend|hide legend/i });
    expect(screen.getByText(/complete/i)).toBeInTheDocument();
    act(() => { toggle.click(); });
    // Chips hide after collapse.
    expect(screen.queryByText(/complete/i)).toBeNull();
  });
});
