/**
 * parseSessionToolCalls — reconstruct the tool-call timeline from a
 * pi-coding-agent session JSONL so reopening a project rebuilds its tool
 * cards (issue #161 follow-up).
 *
 * The session log records, in order:
 *   - assistant messages whose `content[]` carries `{type:'toolCall', id,
 *     name, arguments}` envelopes, and
 *   - separate `{role:'toolResult', toolCallId, content:[{type:'text'}],
 *     details, isError}` messages.
 *
 * The main-process history rehydrator (`getSessionHistorySnapshot`) used to
 * drop these and return `toolCalls: []`. This joins each call to its result
 * (by id) and returns the records the renderer's restore path already knows
 * how to render.
 */

export interface SessionToolCall {
  id: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error';
  startTime: number;
  /** Flattened text of the tool result, when one was recorded. */
  resultText?: string;
  /** Structured `details` from the tool result (cascade, missing refs, …). */
  details?: Record<string, unknown>;
}

interface RawEnvelope {
  type?: string;
  message?: RawMessage;
  timestamp?: string;
}
interface RawMessage {
  role?: string;
  content?: unknown;
  timestamp?: number;
  toolCallId?: string;
  details?: unknown;
  isError?: boolean;
}
interface RawContentEntry {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  arguments?: unknown;
}

function flattenText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as RawContentEntry[])
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
  }
  return '';
}

function timestampOf(env: RawEnvelope, m: RawMessage): number {
  if (typeof m.timestamp === 'number') return m.timestamp;
  if (typeof env.timestamp === 'string') {
    const t = Date.parse(env.timestamp);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

export function parseSessionToolCalls(jsonlText: string): SessionToolCall[] {
  const envelopes = jsonlText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as RawEnvelope;
      } catch {
        return null;
      }
    })
    .filter((e): e is RawEnvelope => !!e && e.type === 'message' && !!e.message);

  // Results keyed by the call id they answer.
  const results = new Map<
    string,
    { resultText?: string; details?: Record<string, unknown>; isError: boolean }
  >();
  envelopes.forEach((env) => {
    const m = env.message as RawMessage;
    if (m.role !== 'toolResult' || typeof m.toolCallId !== 'string') return;
    const resultText = flattenText(m.content);
    const details =
      m.details && typeof m.details === 'object'
        ? (m.details as Record<string, unknown>)
        : undefined;
    results.set(m.toolCallId, {
      ...(resultText ? { resultText } : {}),
      ...(details ? { details } : {}),
      isError: m.isError === true,
    });
  });

  // Calls in document order, each joined to its result.
  return envelopes.flatMap((env) => {
    const m = env.message as RawMessage;
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return [];
    const startTime = timestampOf(env, m);
    return (m.content as RawContentEntry[])
      .filter((c) => c && c.type === 'toolCall' && typeof c.id === 'string')
      .map((c) => {
        const r = results.get(c.id as string);
        return {
          id: c.id as string,
          toolName: typeof c.name === 'string' ? c.name : '(unknown tool)',
          status: r ? (r.isError ? 'error' : 'completed') : 'executing',
          startTime,
          ...(c.arguments && typeof c.arguments === 'object'
            ? { args: c.arguments as Record<string, unknown> }
            : {}),
          ...(r?.resultText ? { resultText: r.resultText } : {}),
          ...(r?.details ? { details: r.details } : {}),
        } satisfies SessionToolCall;
      });
  });
}
