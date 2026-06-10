import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import TranscriptTurn from './TranscriptTurn';
import type { TurnEntry } from '../ChatPanelEmbedded/coalesceTranscript';

describe('TranscriptTurn', () => {
  const entries: TurnEntry[] = [
    { kind: 'text', message: { id: '1', role: 'assistant', text: 'on it' } },
    {
      kind: 'tool',
      message: {
        id: '2',
        role: 'tool',
        toolName: 'dhee_get_status',
        toolStatus: 'completed',
      },
      condensed: false,
    },
    { kind: 'text', message: { id: '3', role: 'assistant', text: 'done' } },
  ];

  it('renders exactly ONE byline for a multi-entry run', () => {
    render(
      <TranscriptTurn
        entries={entries}
        renderEntry={(e) =>
          e.kind === 'text' ? <p>TEXT:{e.message.text}</p> : null
        }
      />,
    );
    expect(screen.getAllByText('Dhee')).toHaveLength(1);
  });

  it('renders tool entries first-class (humanized title) and delegates the rest', () => {
    render(
      <TranscriptTurn
        entries={entries}
        renderEntry={(e) =>
          e.kind === 'text' ? <p>TEXT:{e.message.text}</p> : null
        }
      />,
    );
    // Tool entry → ToolCard with humanized title (no raw dhee_* name).
    expect(screen.getByText('Checked the status')).toBeInTheDocument();
    // Non-tool entries delegated to renderEntry.
    expect(screen.getByText('TEXT:on it')).toBeInTheDocument();
    expect(screen.getByText('TEXT:done')).toBeInTheDocument();
  });

  it('passes the condensed flag through to the ToolCard', () => {
    render(
      <TranscriptTurn
        entries={[
          {
            kind: 'tool',
            message: {
              id: '2',
              role: 'tool',
              toolName: 'dhee_get_status',
              toolStatus: 'completed',
              toolResultText:
                'Status counts:\n  pending:     1\n  in_progress: 0\n  completed:   3\n  failed:      0',
            },
            condensed: true,
          },
        ]}
        renderEntry={() => null}
      />,
    );
    // Condensed → one-line chip, not the expanded meter.
    expect(screen.getByText('3/4 done')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
