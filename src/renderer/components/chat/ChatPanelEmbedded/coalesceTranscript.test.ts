import { describe, it, expect } from '@jest/globals';
import type { ChatMessage, Role } from './chatMessageModel';
import {
  coalesceTranscript,
  type TranscriptItem,
  type TurnEntry,
} from './coalesceTranscript';

let counter = 0;
function mk(role: Role, extra: Partial<ChatMessage> = {}): ChatMessage {
  counter += 1;
  return { id: `m${counter}`, role, ...extra };
}

function asTurn(item: TranscriptItem) {
  if (item.kind !== 'turn') throw new Error(`expected turn, got ${item.kind}`);
  return item;
}

function entryKinds(entries: TurnEntry[]): string[] {
  return entries.map((e) => e.kind);
}

describe('coalesceTranscript — Problem 1 (one byline per author run)', () => {
  it('collapses a run of consecutive assistant-side messages into ONE turn', () => {
    const items = coalesceTranscript([
      mk('assistant', { text: 'Good call.' }),
      mk('tool', { toolName: 'dhee_get_status', toolStatus: 'completed' }),
      mk('tool', { toolName: 'dhee_critique_node', toolStatus: 'completed' }),
      mk('assistant', { text: 'Updated the shots.' }),
    ]);
    expect(items).toHaveLength(1);
    const turn = asTurn(items[0]);
    expect(entryKinds(turn.entries)).toEqual(['text', 'tool', 'tool', 'text']);
  });

  it('keeps user messages as standalone items that break the run', () => {
    const items = coalesceTranscript([
      mk('user', { text: 'make it warmer' }),
      mk('assistant', { text: 'on it' }),
      mk('tool', { toolName: 'dhee_critique_node', toolStatus: 'completed' }),
      mk('user', { text: 'now re-render' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'turn', 'user']);
    expect(entryKinds(asTurn(items[1]).entries)).toEqual(['text', 'tool']);
  });

  it('lets a system / phase notice split one Dhee run into two turns', () => {
    const items = coalesceTranscript([
      mk('assistant', { text: 'starting' }),
      mk('system', { text: 'Run resumed', notificationLevel: 'info' }),
      mk('assistant', { text: 'continuing' }),
      mk('phase', { text: 'rendering' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual([
      'turn',
      'system',
      'turn',
      'phase',
    ]);
  });

  it('groups consecutive progress rows within a turn into one progressGroup', () => {
    const items = coalesceTranscript([
      mk('assistant', { text: 'rendering now' }),
      mk('progress', { progressText: '[1/3] shot 1' }),
      mk('progress', { progressText: '[2/3] shot 2' }),
      mk('progress', { progressText: '[3/3] shot 3' }),
      mk('assistant', { text: 'done' }),
    ]);
    expect(items).toHaveLength(1);
    const turn = asTurn(items[0]);
    expect(entryKinds(turn.entries)).toEqual(['text', 'progressGroup', 'text']);
    const pg = turn.entries[1];
    if (pg.kind !== 'progressGroup') throw new Error('expected progressGroup');
    expect(pg.rows).toHaveLength(3);
    expect(pg.rows[2].progressText).toBe('[3/3] shot 3');
  });

  it('routes question / question-card / bundle-choices to standalone items', () => {
    const items = coalesceTranscript([
      mk('assistant', { text: 'pick one' }),
      mk('question-card', {
        questionCard: { question: 'which?', options: [], multiSelect: false },
      }),
      mk('bundle-choices', { bundleChoices: { ids: ['a'] } }),
      mk('question', { question: 'redo?', options: ['yes', 'no'] }),
    ]);
    expect(items.map((i) => i.kind)).toEqual([
      'turn',
      'question-card',
      'bundle-choices',
      'question',
    ]);
  });
});

describe('coalesceTranscript — condense superseded tool cards', () => {
  it('condenses earlier tool/media cards and keeps the latest full', () => {
    const items = coalesceTranscript([
      mk('assistant', { text: 'hi' }),
      mk('tool', { toolName: 'dhee_get_status', toolStatus: 'completed' }),
      mk('tool', { toolName: 'dhee_critique_node', toolStatus: 'completed' }),
      mk('media', { mediaKind: 'image', mediaPath: '/x.png' }),
    ]);
    const turn = asTurn(items[0]);
    const tools = turn.entries.filter((e) => e.kind === 'tool');
    expect(tools.every((e) => e.kind === 'tool' && e.condensed)).toBe(true);
    const media = turn.entries.find((e) => e.kind === 'media');
    if (!media || media.kind !== 'media') throw new Error('expected media');
    expect(media.condensed).toBe(false);
  });

  it('never condenses an in-progress tool (it is the live edge)', () => {
    const items = coalesceTranscript([
      mk('tool', { toolName: 'dhee_get_status', toolStatus: 'completed' }),
      mk('tool', { toolName: 'dhee_start_run', toolStatus: 'in_progress' }),
    ]);
    const turn = asTurn(items[0]);
    const [first, second] = turn.entries;
    if (first.kind !== 'tool' || second.kind !== 'tool')
      throw new Error('expected two tool entries');
    expect(first.condensed).toBe(true);
    expect(second.condensed).toBe(false);
  });

  it('a single tool card is shown full', () => {
    const items = coalesceTranscript([
      mk('tool', { toolName: 'dhee_get_status', toolStatus: 'completed' }),
    ]);
    const turn = asTurn(items[0]);
    const only = turn.entries[0];
    if (only.kind !== 'tool') throw new Error('expected tool');
    expect(only.condensed).toBe(false);
  });
});

describe('coalesceTranscript — edge cases', () => {
  it('returns an empty list for no messages', () => {
    expect(coalesceTranscript([])).toEqual([]);
  });

  it('gives each turn a stable id derived from its first message', () => {
    const items = coalesceTranscript([mk('assistant', { text: 'a' })]);
    const turn = asTurn(items[0]);
    expect(typeof turn.id).toBe('string');
    expect(turn.id.length).toBeGreaterThan(0);
  });
});
