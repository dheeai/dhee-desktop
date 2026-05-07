/**
 * Shared types for the Electron IPC bridge between main and renderer
 * for the embedded kshana-ink integration.
 *
 * Used by both `main/kshanaIpcBridge.ts` and `renderer/lib/kshanaApi.ts`
 * (and the preload bridge that links them) to keep request/response
 * shapes and event names in sync. The event names mirror kshana-ink's
 * existing `ServerMessageType` so the renderer can reuse the same
 * narrowing logic regardless of transport.
 */

/** Channel names for `ipcMain.handle` / `ipcRenderer.invoke` request/response calls. */
export const KSHANA_CHANNELS = {
  CREATE_SESSION: 'kshana:createSession',
  CONFIGURE_PROJECT: 'kshana:configureProject',
  RUN_TASK: 'kshana:runTask',
  SEND_RESPONSE: 'kshana:sendResponse',
  CANCEL_TASK: 'kshana:cancelTask',
  REDO_NODE: 'kshana:redoNode',
  FOCUS_PROJECT: 'kshana:focusProject',
  SET_AUTONOMOUS: 'kshana:setAutonomous',
  /**
   * Pi-agent oversight toggle. When on, pi-agent is auto-engaged on
   * runner events (failed/completed/per-asset-with-VLM) so it can
   * judge generation outcomes and intervene. Persists per project.
   */
  SET_PI_OVERSIGHT: 'kshana:setPiOversight',
  /**
   * VLM master switch — gates all vision-LLM calls (the new
   * describeImageWithVLM AND the executor-internal review-once gate).
   * Effective only when piOversight is also on. Persists per project.
   */
  SET_VLM_JUDGE: 'kshana:setVlmJudge',
  DELETE_SESSION: 'kshana:deleteSession',
  /**
   * Background task runner cancellation. Cancels whatever long
   * kshana_* job is currently dispatched on the runner singleton —
   * independent of any chat session, so the Stop button stays
   * instant even while the main session's pi-agent is busy.
   */
  RUNNER_CANCEL: 'kshana:runnerCancel',
  /** Background task runner status snapshot (active task or null). */
  RUNNER_STATUS: 'kshana:runnerStatus',
} as const;

/** The single channel for streaming events main → renderer. */
export const KSHANA_EVENT_CHANNEL = 'kshana:event';

/**
 * Event names emitted on the streaming channel. Subset of kshana-ink's
 * `ServerMessageType` — only the events the embedded path actually
 * fires (no remote-FS request/response messages — local mode handles
 * file ops directly via Node fs).
 */
export type KshanaEventName =
  | 'progress'
  | 'tool_call'
  | 'tool_result'
  | 'todo_updated'
  | 'agent_response'
  | 'agent_question'
  | 'status'
  | 'stream_chunk'
  | 'context_usage'
  | 'phase_transition'
  | 'timeline_update'
  | 'notification'
  | 'project_focused'
  | 'media_generated';

/** Payload published on `KSHANA_EVENT_CHANNEL`. */
export interface KshanaEvent {
  /** Which kshana-ink event this is (mirrors ServerMessageType). */
  eventName: KshanaEventName;
  /** Session this event belongs to. */
  sessionId: string;
  /** Event-specific payload. Renderer narrows based on `eventName`. */
  data: unknown;
}

// ── Request / response shapes per channel ────────────────────────────

/**
 * Session role. `'interactive'` (default) is the user's chat
 * session — long-running pipeline tools (kshana_run_to,
 * kshana_render_scene_bundle, kshana_audit_fidelity) are stripped
 * so a chat message can't block on a multi-hour run. `'background'`
 * is the dedicated long-run session (created when the user clicks
 * Resume); it gets the full toolkit.
 */
export type CreateSessionRole = 'interactive' | 'background';

export interface CreateSessionRequest {
  role?: CreateSessionRole;
}

export interface CreateSessionResponse {
  sessionId: string;
}

export interface RunnerCancelResponse {
  cancelled: boolean;
}

export interface RunnerStatusResponse {
  active: boolean;
  taskId?: string;
  kind?: string;
  projectName?: string;
  startedAt?: number;
  sessionId?: string;
}

export interface ConfigureProjectRequest {
  sessionId: string;
  projectDir: string;
  templateId?: string;
  style?: string;
  duration?: number;
  autonomousMode?: boolean;
}

export interface OkResponse {
  ok: boolean;
  error?: string;
}

export interface RunTaskRequest {
  sessionId: string;
  task: string;
  stopAtStage?: string;
}

export interface SendResponseRequest {
  sessionId: string;
  response: string;
  toolCallId?: string;
}

export interface CancelTaskRequest {
  sessionId: string;
}

export interface CancelTaskResponse {
  cancelled: boolean;
}

export interface RedoNodeRequest {
  sessionId: string;
  nodeId: string;
  editedPrompt?: string;
  frame?: string;
  scope?: 'prompt' | 'image_only';
}

export interface FocusProjectRequest {
  sessionId: string;
  projectName: string;
  /**
   * Absolute path to the user-selected `.kshana` directory. Optional
   * for backwards-compatibility, but desktop callers should pass it
   * so kshana-ink looks in the right parent (the folder the user
   * actually opened) instead of falling back to its hardcoded
   * `getProjectsDir()`. The bridge derives `dirname(projectDir)` and
   * stashes it in `KSHANA_PROJECTS_DIR` for the embedded core.
   */
  projectDir?: string;
}

export interface SetAutonomousRequest {
  sessionId: string;
  enabled: boolean;
}

export interface SetPiOversightRequest {
  sessionId: string;
  enabled: boolean;
}

export interface SetVlmJudgeRequest {
  sessionId: string;
  enabled: boolean;
}

export interface DeleteSessionRequest {
  sessionId: string;
}
