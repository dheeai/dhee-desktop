/**
 * activityState — the brain of the ON-SET activity transport (issue #161
 * core: "the user is blind to what the agent is doing").
 *
 * Pure helpers that turn the panel's live signals (agent busy, background
 * runner active, latest progress line, active tool, gate marker, terminal
 * failure) into a single ActivityState the transport renders. One component,
 * one state at a time — replacing the bouncing-dots TypingIndicator.
 */

import { classifyFailure } from './toolPresentation';

export type ActivityKind =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'rendering'
  | 'paused'
  | 'failed'
  | 'done';

export interface ActivitySignals {
  /** The agent's own LLM turn is in flight (session.status === 'running'). */
  agentBusy: boolean;
  /** A background pipeline run is in flight (runnerStatus().active). */
  runnerActive: boolean;
  /** A stop/cancel has been requested but not yet confirmed. */
  pendingCancel: boolean;
  /** The most recent `progress` row's text, for parsing [N/M] counts. */
  latestProgress?: string;
  /** The most recent in-flight tool, for a humanized "working" verb. */
  activeTool?: { toolName: string };
  /** The collection the run paused after, when the gate fired (issue #133). */
  gatedAfter?: string;
  /** Terminal error text when the run / last tool failed. */
  failure?: string;
}

export interface ProgressMeter {
  completed: number;
  total: number;
  pct: number;
}

export interface ActivityState {
  kind: ActivityKind;
  verb: string;
  object?: string;
  progress?: ProgressMeter;
  failureClass?: 'transient' | 'structural';
}

const COUNTS_RE = /\[(\d+)\s*\/\s*(\d+)\]/;

export function parseProgressCounts(
  text: string,
): { completed: number; total: number; label: string } | null {
  const m = COUNTS_RE.exec(text);
  if (!m) return null;
  const completed = Number(m[1]);
  const total = Number(m[2]);
  const label = text.slice(m.index + m[0].length).trim();
  return { completed, total, label };
}

/**
 * Present-continuous phrasing for the live transport. Only the handful of
 * tools that actually run long enough to watch need bespoke verbs; anything
 * else gets a generic "Working". (Card titles use the past-tense
 * humanizeTool; the live transport wants the -ing form.)
 */
const ACTIVE_VERB: Record<string, { verb: string; object?: string }> = {
  dhee_get_status: { verb: 'Reading', object: 'the status' },
  dhee_critique_node: { verb: 'Critiquing' },
  dhee_write_node_content: { verb: 'Writing' },
  dhee_regenerate_node: { verb: 'Regenerating' },
  dhee_show_node_output: { verb: 'Loading', object: 'the output' },
  dhee_start_run: { verb: 'Starting the run' },
};

function activeVerb(toolName: string): { verb: string; object?: string } {
  return ACTIVE_VERB[toolName] ?? { verb: 'Working' };
}

function failureGist(error: string): string {
  const firstLine = error.split('\n')[0].trim();
  return firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine;
}

export function deriveActivityState(s: ActivitySignals): ActivityState {
  // Terminal / blocking states first — they must surface over live activity.
  if (s.failure) {
    return {
      kind: 'failed',
      verb: 'Failed',
      object: failureGist(s.failure),
      failureClass: classifyFailure(s.failure),
    };
  }

  if (s.gatedAfter) {
    return { kind: 'paused', verb: 'Paused', object: `after ${s.gatedAfter}` };
  }

  if (s.pendingCancel) {
    return { kind: 'working', verb: 'Stopping', object: 'the run' };
  }

  if (s.runnerActive) {
    const counts = s.latestProgress
      ? parseProgressCounts(s.latestProgress)
      : null;
    if (counts) {
      const pct =
        counts.total > 0
          ? Math.min(100, Math.round((counts.completed / counts.total) * 100))
          : 0;
      return {
        kind: 'rendering',
        verb: 'Rendering',
        object: counts.label || undefined,
        progress: { completed: counts.completed, total: counts.total, pct },
      };
    }
    const av = s.activeTool
      ? activeVerb(s.activeTool.toolName)
      : { verb: 'Running', object: 'the pipeline' };
    return { kind: 'working', verb: av.verb, object: av.object };
  }

  if (s.agentBusy) {
    if (s.activeTool) {
      const av = activeVerb(s.activeTool.toolName);
      return { kind: 'working', verb: av.verb, object: av.object };
    }
    return { kind: 'thinking', verb: 'Thinking' };
  }

  return { kind: 'idle', verb: '' };
}
