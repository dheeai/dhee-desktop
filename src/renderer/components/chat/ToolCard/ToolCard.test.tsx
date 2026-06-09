import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolCard from './ToolCard';
import type { ChatMessage } from '../ChatPanelEmbedded/chatMessageModel';

const tool = (extra: Partial<ChatMessage>): ChatMessage => ({
  id: 't',
  role: 'tool',
  ...extra,
});

const STATUS_TEXT = [
  'Status counts:',
  '  pending:     11',
  '  in_progress: 1',
  '  completed:   28',
  '  failed:      0',
].join('\n');

describe('ToolCard', () => {
  it('renders a humanized title and never the raw dhee_* name', () => {
    const { container } = render(
      <ToolCard
        message={tool({
          toolName: 'dhee_critique_node',
          toolStatus: 'completed',
          toolArgs: { nodeId: 'opening_beat' },
          toolDetails: { affectedNodes: ['shot_01'] },
        })}
      />,
    );
    expect(container.textContent).toContain('Critiqued');
    expect(container.textContent).not.toMatch(/dhee_/);
  });

  it('renders the status readout counts + meter', () => {
    render(
      <ToolCard
        message={tool({
          toolName: 'dhee_get_status',
          toolStatus: 'completed',
          toolResultText: STATUS_TEXT,
        })}
      />,
    );
    expect(screen.getByText('Checked the status')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '28');
    expect(bar).toHaveAttribute('aria-valuemax', '40');
  });

  it('renders the cascade blast radius for an edit', () => {
    render(
      <ToolCard
        message={tool({
          toolName: 'dhee_critique_node',
          toolStatus: 'completed',
          toolArgs: { nodeId: 'opening_beat' },
          toolDetails: {
            affectedNodes: ['shot_01', 'shot_02', 'shot_03', 'shot_04'],
          },
        })}
      />,
    );
    expect(screen.getByText('shot_01')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText(/Re-runs/)).toBeInTheDocument();
  });

  it('renders a take strip with the selected take marked', () => {
    render(
      <ToolCard
        message={tool({
          toolName: 'dhee_list_versions',
          toolStatus: 'completed',
          toolResultText: [
            'Versions for shot_07 (3 candidates):',
            '★ v3           via ltx_director $0.0400 → /a/v3.png',
            '  v2           via ltx_director $0.0400 → /a/v2.png',
            '  v1           via flux_still $0.0200 → /a/v1.png',
          ].join('\n'),
        })}
      />,
    );
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('★')).toBeInTheDocument();
  });

  it('classifies a transient failure', () => {
    render(
      <ToolCard
        message={tool({
          toolName: 'dhee_start_run',
          toolStatus: 'error',
          toolResultText: 'transient upstream error after 3 attempts — 502',
        })}
      />,
    );
    expect(screen.getByText('Transient · retryable')).toBeInTheDocument();
  });

  it('classifies a structural failure', () => {
    render(
      <ToolCard
        message={tool({
          toolName: 'dhee_critique_node',
          toolStatus: 'error',
          toolResultText: 'schema validation failed: mood not in enum',
        })}
      />,
    );
    expect(screen.getByText('Structural · fix the node')).toBeInTheDocument();
  });

  it('condensed shows a one-line summary and expands to the full card on click', () => {
    render(
      <ToolCard
        condensed
        message={tool({
          toolName: 'dhee_get_status',
          toolStatus: 'completed',
          toolResultText: STATUS_TEXT,
        })}
      />,
    );
    // Condensed: chip visible, full body (meter) not yet rendered.
    expect(screen.getByText('28/40 done')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('a non-condensed (live-edge) card can still be collapsed', () => {
    render(
      <ToolCard
        message={tool({
          toolName: 'dhee_get_status',
          toolStatus: 'completed',
          toolResultText: STATUS_TEXT,
        })}
      />,
    );
    // Live-edge cards start expanded…
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    // …but are still collapsible (every card folds, not just superseded ones).
    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders an artifact image inside the card body', () => {
    render(
      <ToolCard
        projectDirectory="/proj"
        message={tool({
          toolName: 'dhee_show_node_output',
          toolStatus: 'completed',
          toolArgs: { nodeId: 'shot_1' },
          toolDetails: { file_path: '/proj/assets/shot_1.png', asset_type: 'image' },
        })}
      />,
    );
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toMatch(/shot_1\.png/);
  });

  it('expanded condensed card can be collapsed again', () => {
    render(
      <ToolCard
        condensed
        message={tool({
          toolName: 'dhee_get_status',
          toolStatus: 'completed',
          toolResultText: STATUS_TEXT,
        })}
      />,
    );
    // Expand.
    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    // Collapse back to the one-line summary.
    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('28/40 done')).toBeInTheDocument();
  });
});
