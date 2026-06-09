import { describe, it, expect } from '@jest/globals';
import { parseSessionToolCalls } from './parseSessionToolCalls';

// Builders mirroring the real pi-session JSONL shape:
//  - assistant message: content[] includes {type:'toolCall', id, name, arguments}
//  - toolResult message: {role:'toolResult', toolCallId, toolName, content:[{type:'text',text}], details, isError}
const line = (obj: unknown) => JSON.stringify(obj);
const call = (id: string, name: string, args: Record<string, unknown>, ts: number) =>
  line({
    type: 'message',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'working' },
        { type: 'toolCall', id, name, arguments: args },
      ],
      timestamp: ts,
    },
  });
const result = (
  id: string,
  text: string,
  details: unknown,
  isError: boolean,
  ts: number,
) =>
  line({
    type: 'message',
    message: {
      role: 'toolResult',
      toolCallId: id,
      content: [{ type: 'text', text }],
      details,
      isError,
      timestamp: ts,
    },
  });

describe('parseSessionToolCalls', () => {
  it('joins a tool call to its successful result with args, text and details', () => {
    const jsonl = [
      call('fc-1', 'dhee_get_status', { projectDir: '/p' }, 1000),
      result('fc-1', 'Status counts:\n  completed:   3', { target: { aspect: '16:9' } }, false, 1001),
    ].join('\n');
    const calls = parseSessionToolCalls(jsonl);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 'fc-1',
      toolName: 'dhee_get_status',
      status: 'completed',
      args: { projectDir: '/p' },
      details: { target: { aspect: '16:9' } },
    });
    expect(calls[0].resultText).toContain('Status counts');
  });

  it('marks an errored result as error', () => {
    const jsonl = [
      call('fc-2', 'dhee_critique_node', { nodeId: 'x' }, 1),
      result('fc-2', 'schema validation failed', undefined, true, 2),
    ].join('\n');
    expect(parseSessionToolCalls(jsonl)[0].status).toBe('error');
  });

  it('leaves a call with no matching result as executing', () => {
    const calls = parseSessionToolCalls(call('fc-3', 'dhee_start_run', {}, 1));
    expect(calls[0].status).toBe('executing');
    expect(calls[0].resultText).toBeUndefined();
  });

  it('preserves document order and joins each call independently', () => {
    const jsonl = [
      call('a', 't1', {}, 1),
      result('a', 'ra', undefined, false, 2),
      call('b', 't2', {}, 3),
      result('b', 'rb', undefined, false, 4),
    ].join('\n');
    const calls = parseSessionToolCalls(jsonl);
    expect(calls.map((c) => c.id)).toEqual(['a', 'b']);
    expect(calls[1].resultText).toBe('rb');
  });

  it('ignores text/thinking content, non-message lines, and malformed JSON', () => {
    const jsonl = [
      'this is not json',
      line({ type: 'session', id: 's' }),
      line({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'hmm' },
            { type: 'text', text: 'just prose, no tools' },
          ],
          timestamp: 1,
        },
      }),
      call('fc-9', 'dhee_grep', { pattern: 'horizon' }, 2),
    ].join('\n');
    const calls = parseSessionToolCalls(jsonl);
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe('fc-9');
    expect(calls[0].args).toEqual({ pattern: 'horizon' });
  });

  it('flattens multiple text parts in a result', () => {
    const jsonl = [
      call('fc-1', 't', {}, 1),
      line({
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'fc-1',
          content: [
            { type: 'text', text: 'A' },
            { type: 'text', text: 'B' },
          ],
          isError: false,
          timestamp: 2,
        },
      }),
    ].join('\n');
    expect(parseSessionToolCalls(jsonl)[0].resultText).toBe('AB');
  });

  it('returns an empty list for empty / toolless input', () => {
    expect(parseSessionToolCalls('')).toEqual([]);
    expect(parseSessionToolCalls(line({ type: 'session' }))).toEqual([]);
  });
});
