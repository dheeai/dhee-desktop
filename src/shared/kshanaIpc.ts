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
  /**
   * Mark executor nodes `pending` on disk without running them. Used
   * by the Prompts-tab edit flow: after the user saves a per-shot
   * prompt change, the dependent image / video node is invalidated
   * here so the next pipeline run regenerates it. Pure state mutation
   * — does NOT engage the agent or kick off a run.
   */
  INVALIDATE_NODES: 'kshana:invalidateNodes',
  /**
   * Custom ComfyUI workflow management. The renderer (Settings →
   * Workflows tab) calls these to list/get/update/delete user
   * workflows directly. The conversational add-a-workflow flow goes
   * through pi-agent tools, NOT these channels — but a one-off
   * "validate this JSON" pre-flight from the renderer might use
   * VALIDATE_WORKFLOW.
   */
  LIST_WORKFLOWS: 'kshana:listWorkflows',
  GET_WORKFLOW: 'kshana:getWorkflow',
  UPDATE_WORKFLOW: 'kshana:updateWorkflow',
  DELETE_WORKFLOW: 'kshana:deleteWorkflow',
  VALIDATE_WORKFLOW: 'kshana:validateWorkflow',
  /**
   * Hard-delete the persisted chat for a session and mint a fresh
   * sessionId. Used by the "New chat" button. The renderer must
   * replace its cached id (in localStorage and React state) with the
   * value returned in `ClearChatHistoryResponse.newSessionId`.
   */
  CLEAR_CHAT_HISTORY: 'kshana:clearChatHistory',
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
  /**
   * If set, the main process tries to resume the named session from
   * the on-disk session index. When the id is recognized and its
   * JSONL still exists, the response carries `resumed: true`,
   * `sessionId` matches the request, and `history` is populated.
   * Unknown ids fall through to a fresh-session create — the
   * caller can detect this by comparing returned `sessionId` to the
   * requested one (or checking `resumed`).
   */
  resumeSessionId?: string;
}

/**
 * Snapshot of a previously-persisted chat. Mirrors kshana-core's
 * `HistoryData` shape — keep in sync. Sent on session resume so the
 * renderer can hydrate its chat panel without an extra round-trip.
 */
export interface HistorySnapshot {
  messages: Array<{
    id: string;
    type: 'agent' | 'user' | 'system' | 'media';
    content: string;
    timestamp: number;
    agentName?: string;
    media?: {
      kind: 'image' | 'video';
      path: string;
      project: string;
      source?: string;
    };
  }>;
  toolCalls: Array<{
    id: string;
    toolName: string;
    args?: Record<string, string>;
    status: 'executing' | 'completed' | 'error';
    result?: unknown;
    startTime: number;
    duration?: number;
    agentName?: string;
  }>;
  focusedProject?: string;
  compactionCount: number;
}

export interface CreateSessionResponse {
  sessionId: string;
  /** True when the session was reconstructed from the on-disk index. */
  resumed?: boolean;
  /**
   * Persisted chat snapshot — only present when `resumed` is true and
   * the JSONL had something to replay. Renderer should seed its
   * message list from this.
   */
  history?: HistorySnapshot;
}

export interface ClearChatHistoryRequest {
  sessionId: string;
  /** Optional role for the freshly-minted replacement session. */
  role?: CreateSessionRole;
}

export interface ClearChatHistoryResponse {
  /** New sessionId minted by the main process. */
  newSessionId: string;
  /** The id whose history was wiped. */
  oldSessionId: string;
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
  /**
   * Files the user attached in the chat input. Currently only
   * `comfy_workflow` is implemented — text/image/video/audio kinds
   * are reserved (see src/shared/attachmentTypes.ts).
   *
   * The main process transforms these into textual hints that
   * prepend the task message before kshana-core sees it. This keeps
   * the kshana-core ConversationManager API unchanged while still
   * being structurally typed across the IPC boundary.
   */
  attachments?: import('./attachmentTypes').Attachment[];
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

export interface InvalidateNodesRequest {
  sessionId: string;
  nodeIds: string[];
}

export interface InvalidateNodesResponse {
  ok: boolean;
  invalidated?: string[];
  notFound?: string[];
  error?: string;
}

// ── Custom ComfyUI workflow management ─────────────────────────────

/**
 * Summary returned by listWorkflows. The full WorkflowManifest is only
 * fetched on demand via getWorkflow(id) since manifests can be large
 * and the list view doesn't need everything.
 */
export interface WorkflowSummary {
  id: string;
  displayName: string;
  pipeline: string;
  builtIn: boolean;
  isOverride: boolean;
  active: boolean;
}

export interface ListWorkflowsRequest {
  /** If true, return only user-uploaded workflows. Default false. */
  userOnly?: boolean;
}

export interface ListWorkflowsResponse {
  ok: boolean;
  workflows?: WorkflowSummary[];
  error?: string;
}

export interface GetWorkflowRequest {
  id: string;
}

export interface GetWorkflowResponse {
  ok: boolean;
  /** Full manifest as a JSON-serializable object. Renderer treats as `unknown` and validates fields it cares about. */
  manifest?: Record<string, unknown>;
  error?: string;
}

export interface UpdateWorkflowRequest {
  id: string;
  /** Fields to patch. Same shape as kshana-core's WorkflowUpdate type. */
  patch: Record<string, unknown>;
}

export interface UpdateWorkflowResponse {
  ok: boolean;
  manifest?: Record<string, unknown>;
  error?: string;
}

export interface DeleteWorkflowRequest {
  id: string;
}

export interface DeleteWorkflowResponse {
  ok: boolean;
  error?: string;
}

export interface ValidateWorkflowRequest {
  /** Absolute path to the workflow JSON file. */
  path: string;
}

export interface ValidateWorkflowResponse {
  ok: boolean;
  /** True if the file is a valid ComfyUI workflow. */
  valid: boolean;
  /** Reason it's invalid (set when valid=false). */
  reason?: string;
  totalNodes?: number;
  detectedPipeline?: string;
  inputNodeCount?: number;
  loraCount?: number;
  /** Set when ok=false (an error occurred while attempting validation). */
  error?: string;
}
