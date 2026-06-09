/**
 * coalesceTranscript — Problem 1 of issue #161.
 *
 * The agent emits one turn as MANY messages (prose, tool calls, progress,
 * reasoning, media). Rendered naively, each becomes its own stamped block
 * with its own "DHEE" eyebrow — a single turn becomes N boxes. This pure
 * function groups a run of consecutive assistant-side messages into ONE
 * `turn` so the UI can render a single byline with everything flowing
 * beneath it. The eyebrow only re-appears when the author actually changes
 * (a user message, or a system / phase / interactive item between turns).
 *
 * It also folds consecutive `progress` rows into a progressGroup (preserving
 * the old `groupConsecutiveProgress` behaviour) and marks which tool/media
 * entries are "superseded" so the UI can condense them — only the latest
 * (or an in-progress) tool/media card stays full.
 */

import type { ChatMessage } from './chatMessageModel';

export type TurnEntry =
  | { kind: 'text'; message: ChatMessage }
  | { kind: 'tool'; message: ChatMessage; condensed: boolean }
  | { kind: 'media'; message: ChatMessage; condensed: boolean }
  | { kind: 'thinking'; message: ChatMessage }
  | { kind: 'progressGroup'; id: string; rows: ChatMessage[] };

export type TranscriptItem =
  | { kind: 'turn'; id: string; entries: TurnEntry[] }
  | { kind: 'user'; message: ChatMessage }
  | { kind: 'system'; message: ChatMessage }
  | { kind: 'phase'; message: ChatMessage }
  | { kind: 'question'; message: ChatMessage }
  | { kind: 'question-card'; message: ChatMessage }
  | { kind: 'bundle-choices'; message: ChatMessage };

/**
 * Roles that belong to the agent's "doing / saying" stream and therefore
 * coalesce into one byline. User input, system / phase notices, and
 * interactive prompts are punctuation between turns and stand alone.
 */
const ASSISTANT_SIDE = new Set<ChatMessage['role']>([
  'assistant',
  'tool',
  'thinking',
  'progress',
  'media',
]);

/** Standalone (non-turn) items, keyed by the role that produces them. */
const STANDALONE_KINDS = {
  user: 'user',
  system: 'system',
  phase: 'phase',
  question: 'question',
  'question-card': 'question-card',
  'bundle-choices': 'bundle-choices',
} as const;

/**
 * Condense every tool/media entry EXCEPT the latest one — that one is the
 * live edge and stays full. An in-progress tool is always full (it is, by
 * definition, the live edge). Prose / thinking / progress are never
 * condensed here.
 */
function applyCondenseFlags(entries: TurnEntry[]): void {
  // Index of the last tool/media entry — the live edge.
  let liveEdge = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].kind === 'tool' || entries[i].kind === 'media') {
      liveEdge = i;
      break;
    }
  }

  entries.forEach((entry, i) => {
    if (entry.kind !== 'tool' && entry.kind !== 'media') return;
    const isInProgress = entry.message.toolStatus === 'in_progress';
    entry.condensed = !(i === liveEdge || isInProgress);
  });
}

/** Build the in-turn entries from a run of assistant-side messages. */
function buildTurnEntries(run: ChatMessage[]): TurnEntry[] {
  const entries: TurnEntry[] = [];

  for (let i = 0; i < run.length; i += 1) {
    const msg = run[i];

    // Fold a run of consecutive progress rows into one group.
    if (msg.role === 'progress') {
      const rows: ChatMessage[] = [];
      while (i < run.length && run[i].role === 'progress') {
        rows.push(run[i]);
        i += 1;
      }
      i -= 1; // step back: outer loop will advance past the last row
      entries.push({
        kind: 'progressGroup',
        id: `progress-${rows[0].id}`,
        rows,
      });
    } else if (msg.role === 'tool') {
      entries.push({ kind: 'tool', message: msg, condensed: false });
    } else if (msg.role === 'media') {
      entries.push({ kind: 'media', message: msg, condensed: false });
    } else if (msg.role === 'thinking') {
      entries.push({ kind: 'thinking', message: msg });
    } else {
      // assistant prose
      entries.push({ kind: 'text', message: msg });
    }
  }

  applyCondenseFlags(entries);
  return entries;
}

export function coalesceTranscript(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let run: ChatMessage[] = [];

  const flush = () => {
    if (run.length === 0) return;
    items.push({
      kind: 'turn',
      id: `turn-${run[0].id}`,
      entries: buildTurnEntries(run),
    });
    run = [];
  };

  messages.forEach((message) => {
    if (ASSISTANT_SIDE.has(message.role)) {
      run.push(message);
      return;
    }
    flush();
    const kind =
      STANDALONE_KINDS[message.role as keyof typeof STANDALONE_KINDS];
    if (kind) {
      items.push({ kind, message } as TranscriptItem);
    }
  });
  flush();

  return items;
}
