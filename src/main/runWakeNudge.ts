/**
 * runWakeNudge — pure builders for the synthetic system message the
 * desktop injects into the owning agent session when a background run
 * reaches a terminal state (Phase 2 of interruptible-runs).
 *
 * Non-blocking `dhee_start_run` ends the agent turn immediately, so the
 * agent is no longer "watching" the run. When the run finishes we tap
 * it on the shoulder with one of these messages so it can announce
 * completion or react to a failure — replacing the single-turn
 * narration the old blocking `dhee_run_bundle` gave for free.
 *
 * Kept pure + separate so the wording + the transient/structural
 * classification are unit-testable without the Electron/runner stack.
 */

/** Marker the core's transientRetry helper stamps when retries exhaust. */
const TRANSIENT_MARKER = 'transient upstream error after';

const TRANSIENT_HINTS = [
  TRANSIENT_MARKER,
  '502',
  '503',
  '504',
  'bad gateway',
  'gateway time-out',
  'gateway timeout',
  'econnreset',
  'etimedout',
  'fetch failed',
  'socket hang up',
  // An empty LLM response is a model/gateway hiccup, not a content
  // problem — treat it as transient so the agent is told to retry,
  // not to "fix the upstream node". (llm.generate already retries it
  // internally; this covers the case where every attempt came back
  // empty.)
  'empty response',
  'no content',
];

export function isTransientFailure(error: string | undefined): boolean {
  if (!error) return false;
  const m = error.toLowerCase();
  return TRANSIENT_HINTS.some((h) => m.includes(h));
}

export function buildCompletedNudge(opts: { videoPath?: string }): string {
  const where = opts.videoPath ? ` The final video is at ${opts.videoPath}.` : '';
  return (
    `[system] The bundle run just completed in the background.${where} ` +
    `Tell the user it's done and offer to show it. Do not start another run unless they ask.`
  );
}

export function buildFailedNudge(opts: { error?: string; nodeId?: string }): string {
  const at = opts.nodeId ? ` at node ${opts.nodeId}` : '';
  const err = opts.error ?? '(no error detail)';
  if (isTransientFailure(opts.error)) {
    return (
      `[system] The bundle run failed${at} with a transient upstream error: ${err}. ` +
      `This is usually the Comfy endpoint / tunnel being briefly flaky, not a real problem — ` +
      `it may have recovered. Tell the user and offer to retry (dhee_start_run). ` +
      `Call dhee_get_status first to see exactly where it stopped.`
    );
  }
  return (
    `[system] The bundle run failed${at}: ${err}. ` +
    `This looks structural (not a transient network blip). Call dhee_get_status to inspect, ` +
    `then fix the upstream LLM node (dhee_critique_node / dhee_write_node_content) and ` +
    `dhee_start_run to resume. Explain the issue to the user.`
  );
}

/**
 * Best-effort node-id extraction from a walker/runner error string.
 * Errors often look like "comfy.image: upload failed for …" or carry a
 * `node:item` token. Returns undefined when nothing matches — the nudge
 * still works without it.
 */
export function extractNodeId(error: string | undefined): string | undefined {
  if (!error) return undefined;
  // Matches scene_N_shot_M / shot_image:scene_1_shot_3 style tokens.
  const m = error.match(/\b([a-z_]+:[a-z0-9_]+)\b/i) ?? error.match(/\b(scene_\d+_shot_\d+)\b/i);
  return m ? m[1] : undefined;
}
