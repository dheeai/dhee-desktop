/* eslint-disable react/require-default-props */
import { Fragment, type ReactNode } from 'react';
import { Clapperboard } from 'lucide-react';
import type { TurnEntry } from '../ChatPanelEmbedded/coalesceTranscript';
import ToolCard from '../ToolCard';
import styles from './TranscriptTurn.module.scss';

export interface TranscriptTurnProps {
  entries: TurnEntry[];
  /**
   * Renders the non-tool entries (assistant text, media, thinking, progress
   * group). The panel passes its existing renderers here so we reuse the
   * markdown / media / progress rendering that already works; the turn only
   * owns the single byline + the first-class ToolCards.
   */
  renderEntry: (entry: TurnEntry, index: number) => ReactNode;
  byline?: string;
}

/**
 * Problem 1 (#161): a run of consecutive agent messages renders as ONE
 * authored block — a single byline, everything flowing beneath it. Tool
 * entries render first-class via ToolCard (condensed when superseded);
 * other entries are delegated to `renderEntry`.
 */
export default function TranscriptTurn({
  entries,
  renderEntry,
  byline = 'Dhee',
}: TranscriptTurnProps) {
  return (
    <div className={styles.turn}>
      <div className={styles.byline}>
        <span className={styles.glyph}>
          <Clapperboard size={11} />
        </span>
        <span className={styles.name}>{byline}</span>
      </div>
      <div className={styles.entries}>
        {entries.map((entry, index) => {
          if (entry.kind === 'tool') {
            return (
              <ToolCard
                key={entry.message.id}
                message={entry.message}
                condensed={entry.condensed}
              />
            );
          }
          const key =
            entry.kind === 'progressGroup' ? entry.id : entry.message.id;
          return <Fragment key={key}>{renderEntry(entry, index)}</Fragment>;
        })}
      </div>
    </div>
  );
}
