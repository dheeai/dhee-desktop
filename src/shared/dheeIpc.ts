/**
 * Shared types for the Electron IPC bridge between main and renderer
 * for the embedded dhee-ink integration.
 *
 * Used by both `main/dheeIpcBridge.ts` and `renderer/lib/dheeApi.ts`
 * (and the preload bridge that links them) to keep request/response
 * shapes and event names in sync. The event names mirror dhee-ink's
 * existing `ServerMessageType` so the renderer can reuse the same
 * narrowing logic regardless of transport.
 */

/** Channel names for `ipcMain.handle` / `ipcRenderer.invoke` request/response calls. */
export const dhee_CHANNELS = {
  CREATE_SESSION: 'dhee:createSession',
  CONFIGURE_PROJECT: 'dhee:configureProject',
  RUN_TASK: 'dhee:runTask',
  /**
   * Phase 6.5: send a user message to the chat session's pi-agent
   * and return {assistant_text, tool_calls}. Distinct from RUN_TASK
   * which dispatches bundle runs via BackgroundTaskRunner — chat is
   * for free-form interaction with the LLM, run is for kicking the
   * walker.
   */
  CHAT_PROMPT: 'dhee:chatPrompt',
  SEND_RESPONSE: 'dhee:sendResponse',
  CANCEL_TASK: 'dhee:cancelTask',
  REDO_NODE: 'dhee:redoNode',
  FOCUS_PROJECT: 'dhee:focusProject',
  SET_AUTONOMOUS: 'dhee:setAutonomous',
  /**
   * Pi-agent oversight toggle. When on, pi-agent is auto-engaged on
   * runner events (failed/completed/per-asset-with-VLM) so it can
   * judge generation outcomes and intervene. Persists per project.
   */
  SET_PI_OVERSIGHT: 'dhee:setPiOversight',
  /**
   * VLM master switch — gates all vision-LLM calls (the new
   * describeImageWithVLM AND the executor-internal review-once gate).
   * Effective only when piOversight is also on. Persists per project.
   */
  SET_VLM_JUDGE: 'dhee:setVlmJudge',
  DELETE_SESSION: 'dhee:deleteSession',
  /**
   * Background task runner cancellation. Cancels whatever long
   * dhee_* job is currently dispatched on the runner singleton —
   * independent of any chat session, so the Stop button stays
   * instant even while the main session's pi-agent is busy.
   */
  RUNNER_CANCEL: 'dhee:runnerCancel',
  /** Background task runner status snapshot (active task or null). */
  RUNNER_STATUS: 'dhee:runnerStatus',
  /**
   * Mark executor nodes `pending` on disk without running them. Used
   * by the Prompts-tab edit flow: after the user saves a per-shot
   * prompt change, the dependent image / video node is invalidated
   * here so the next pipeline run regenerates it. Pure state mutation
   * — does NOT engage the agent or kick off a run.
   */
  INVALIDATE_NODES: 'dhee:invalidateNodes',
  /**
   * Custom ComfyUI workflow management. The renderer (Settings →
   * Workflows tab) calls these to list/get/update/delete user
   * workflows directly. The conversational add-a-workflow flow goes
   * through pi-agent tools, NOT these channels — but a one-off
   * "validate this JSON" pre-flight from the renderer might use
   * VALIDATE_WORKFLOW.
   */
  LIST_WORKFLOWS: 'dhee:listWorkflows',
  GET_WORKFLOW: 'dhee:getWorkflow',
  UPDATE_WORKFLOW: 'dhee:updateWorkflow',
  DELETE_WORKFLOW: 'dhee:deleteWorkflow',
  VALIDATE_WORKFLOW: 'dhee:validateWorkflow',
  /**
   * Hard-delete the persisted chat for a session and mint a fresh
   * sessionId. Used by the "New chat" button. The renderer must
   * replace its cached id (in localStorage and React state) with the
   * value returned in `ClearChatHistoryResponse.newSessionId`.
   */
  CLEAR_CHAT_HISTORY: 'dhee:clearChatHistory',
  /**
   * Refetch a session's persisted chat snapshot from disk. Used by
   * the renderer when the chat panel remounts (e.g. after the user
   * navigates to Settings and back) — `createSession` only returns
   * history when the session is being resumed, so a same-app-run
   * remount needs an explicit refresh against the source of truth
   * (the JSONL transcript) rather than the snapshot cached at
   * create-time, which would miss any messages streamed since.
   */
  GET_HISTORY: 'dhee:getHistory',
  /**
   * Resolve a `bundleSource` string (e.g. 'built-in:narrative_qwen_chain_relay')
   * to its parsed bundle JSON. Used by the Inspector Canvas and the
   * landing-screen tile metadata to discover what artifacts a bundle
   * produces via `displayCapability` tags on nodes — without hardcoding
   * any bundle's internal node names or filesystem paths. The renderer
   * caches the result in ProjectContext; main process resolves via
   * dhee-core's bundleSource helpers.
   */
  RESOLVE_BUNDLE: 'dhee:resolveBundle',
  /**
   * Resolve the per-instance dependency graph projection of a
   * project's event log. The Inspector Cards view consumes this
   * directly — no client-side bundle parsing or file IO. The
   * graph is { instances[], edges[] } folded from
   * .dhee/events.jsonl by `projectInstanceGraph` in dhee-core.
   */
  RESOLVE_INSTANCE_GRAPH: 'dhee:resolveInstanceGraph',
  /**
   * List the version tray for a node instance (every node.completed
   * folded from the event log, with the selected one flagged). Backs
   * the Inspector modal's Versions panel.
   */
  LIST_VERSIONS: 'dhee:listVersions',
  /**
   * Select a specific version for a node instance (emits
   * version.selected). Downstream resolution + the canvas pick it up.
   */
  SELECT_VERSION: 'dhee:selectVersion',
  /**
   * Overwrite a node instance's content with user-edited bytes (from
   * the Inspector modal's inline editor). Marks the node user-completed
   * and cascades downstream — same core path as the agent's
   * dhee_write_node_content tool.
   */
  WRITE_NODE_CONTENT: 'dhee:writeNodeContent',
} as const;

/** The single channel for streaming events main → renderer. */
export const dhee_EVENT_CHANNEL = 'dhee:event';

/**
 * Event names emitted on the streaming channel. Subset of dhee-ink's
 * `ServerMessageType` — only the events the embedded path actually
 * fires (no remote-FS request/response messages — local mode handles
 * file ops directly via Node fs).
 */
export type dheeEventName =
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
  | 'media_generated'
  /**
   * Session lifecycle transition. Emitted on every change of
   * session.state.status — payload `{ status, turnKind? }`. The
   * renderer subscribes to render a "thinking…" or "Supervisor
   * reviewing…" pill so the chat is never frozen with no visible
   * explanation during a server-initiated supervisor turn.
   */
  | 'session_status';

/** Payload published on `dhee_EVENT_CHANNEL`. */
export interface dheeEvent {
  /** Which dhee-ink event this is (mirrors ServerMessageType). */
  eventName: dheeEventName;
  /** Session this event belongs to. */
  sessionId: string;
  /** Event-specific payload. Renderer narrows based on `eventName`. */
  data: unknown;
}

// ── Request / response shapes per channel ────────────────────────────

/**
 * Session role. `'interactive'` (default) is the user's chat
 * session — long-running pipeline tools (dhee_run_to,
 * dhee_render_scene_bundle, dhee_audit_fidelity) are stripped
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
 * Snapshot of a previously-persisted chat. Mirrors dhee-core's
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
    args?: Record<string, unknown>;
    status: 'executing' | 'completed' | 'error';
    result?: unknown;
    /** Flattened tool-result text, when the session recorded one. */
    resultText?: string;
    /** Structured tool-result `details` (cascade nodes, missing refs, …). */
    details?: Record<string, unknown>;
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

export interface GetHistoryRequest {
  sessionId: string;
}

export interface GetHistoryResponse {
  sessionId: string;
  /** Null when the sessionId is unknown to the on-disk index. */
  history: HistorySnapshot | null;
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
  /**
   * True between the moment cancel() is called on the runner and the
   * moment the executor returns. Surfaces "Stopping…" to the desktop
   * Stop/Resume button for cancels initiated by ANY path (user click,
   * pi-agent's dhee_task_cancel, programmatic replace, etc.) —
   * previously only user-click cancels showed "Stopping…" because
   * the local pendingCancel flag was only set in handleCancel().
   */
  cancelling?: boolean;
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
   * prepend the task message before dhee-core sees it. This keeps
   * the dhee-core ConversationManager API unchanged while still
   * being structurally typed across the IPC boundary.
   */
  attachments?: import('./attachmentTypes').Attachment[];
}

/** Phase 6.5: chatPrompt IPC contract. */
export interface ChatPromptRequest {
  sessionId: string;
  message: string;
}

export type ChatPromptResponse =
  | {
      ok: true;
      assistant_text: string;
      tool_calls: Array<{ name: string }>;
    }
  | {
      ok: false;
      error: string;
    };

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
  /**
   * Chat session id (resolves to the focused project). Optional — pass
   * `projectDir` instead when calling from a projectDir-native surface
   * like the Inspector Cards view, which has no chat session.
   */
  sessionId?: string;
  /** Absolute project dir. Takes precedence over sessionId when set. */
  projectDir?: string;
  nodeId: string;
  editedPrompt?: string;
  frame?: string;
  scope?: 'prompt' | 'image_only';
  /**
   * For collection nodes (e.g. `shot_image`), regenerate just this item.
   * The walker keys per-item state as `nodeId:itemId`. Used by the
   * Inspector Canvas right-click on a CollectionRail tile.
   */
  itemId?: string;
}

export interface FocusProjectRequest {
  sessionId: string;
  projectName: string;
  /**
   * Absolute path to the user-selected `.dhee` directory. Optional
   * for backwards-compatibility, but desktop callers should pass it
   * so dhee-ink looks in the right parent (the folder the user
   * actually opened) instead of falling back to its hardcoded
   * `getProjectsDir()`. The bridge derives `dirname(projectDir)` and
   * stashes it in `dhee_PROJECTS_DIR` for the embedded core.
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
  /**
   * Chat session id (resolves to the focused project). Optional — pass
   * `projectDir` instead from a projectDir-native surface (Inspector
   * Cards view) that has no chat session.
   */
  sessionId?: string;
  /** Absolute project dir. Takes precedence over sessionId when set. */
  projectDir?: string;
  nodeIds: string[];
  /**
   * Free-form origin tag forwarded to the kshana-core supervisor event.
   * Two well-known values today:
   *   - `'redo_from_menu'` — the desktop's "Redo from…" UI initiated
   *     this. Skip the supervisor `user_invalidate` event entirely,
   *     because the renderer is about to issue a runTask immediately
   *     and we don't want pi-agent to receive a competing
   *     "DO NOT auto-dispatch" instruction in the same turn.
   *   - `'prompts_tab_save'` — user saved a per-shot prompt edit;
   *     they may NOT want to resume yet. Default behaviour applies
   *     (pi-agent acks and waits).
   * Unset / unknown values fall through to default behaviour.
   */
  source?: string;
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
  /** Fields to patch. Same shape as dhee-core's WorkflowUpdate type. */
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

// ── RESOLVE_BUNDLE ────────────────────────────────────────────────────

export interface ResolveBundleRequest {
  /**
   * The `bundleSource` field from project.json (e.g.
   * 'built-in:narrative_qwen_chain_relay'). Parsed and resolved by
   * dhee-core's bundleSource helpers.
   */
  bundleSource: string;
}

/**
 * Minimal bundle shape the renderer needs. Mirrors dhee-core's
 * `DagBundle` for the fields used by desktop views — id, version, and
 * the node list with each node's id, kind, and displayCapability.
 *
 * We intentionally don't ship the full runner config / prompts /
 * inputs over IPC — desktop views only need to discover what
 * artifacts exist and what they're tagged as. Runtime concerns
 * (workflow paths, runner names) stay on the kshana-core side.
 */
/**
 * Bundle-author-declared tile display metadata. Drives the project
 * tile's thumbnail + summary stats on the landing screen. See
 * docs/display-capabilities.md in dhee-core for field semantics.
 */
export interface BundleDisplay {
  thumbnail?: {
    /** Capability tag, or a priority list tried in order (first available wins). */
    from: string | string[];
    pick?: 'first_completed' | 'random_completed' | 'latest_completed';
  };
  stats?: Array<{
    label: string;
    source: string;
    count_completed?: boolean;
    path?: string;
  }>;
}

/**
 * Per-node `inputs[].from` reference — the upstream node id this node
 * depends on. The renderer uses these to draw edges in the Inspector
 * Canvas; runtime concerns (usage / scope / aggregate) stay on the
 * dhee-core side.
 */
export interface BundleNodeInputRef {
  from: string;
}

// ── RESOLVE_INSTANCE_GRAPH ─────────────────────────────────────────────

export interface ResolveInstanceGraphRequest {
  projectDir: string;
  branchId?: string;
  /** Time-travel: fold only events with seq <= asOfSeq. */
  asOfSeq?: number;
}

export interface InstanceGraphNode {
  nodeId: string;
  itemId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'invalidated';
  outputPath?: string;
  versionId?: string;
  error?: string;
  tool?: string;
  cached?: boolean;
  ts?: number;
}

export interface InstanceGraphEdge {
  fromNodeId: string;
  fromItemId?: string;
  toNodeId: string;
  toItemId?: string;
  role?: string;
}

export interface ResolveInstanceGraphResponse {
  ok: boolean;
  graph?: {
    instances: InstanceGraphNode[];
    edges: InstanceGraphEdge[];
  };
  error?: string;
}

// ── LIST_VERSIONS / SELECT_VERSION ─────────────────────────────────────

export interface ListVersionsRequest {
  projectDir: string;
  nodeId: string;
  itemId?: string;
  branchId?: string;
}

export interface VersionTrayEntry {
  versionId: string;
  outputPath: string;
  selected: boolean;
  createdAt: number;
  /** Generation tool that produced it ('llm.generate', 'comfy.image', 'user', …). */
  tool?: string;
}

export interface ListVersionsResponse {
  ok: boolean;
  versions?: VersionTrayEntry[];
  error?: string;
}

export interface SelectVersionRequest {
  projectDir: string;
  nodeId: string;
  versionId: string;
  itemId?: string;
  branchId?: string;
}

// ── WRITE_NODE_CONTENT ─────────────────────────────────────────────────

export interface WriteNodeContentRequest {
  projectDir: string;
  nodeId: string;
  itemId?: string;
  /** UTF-8 text content the user edited in the Inspector modal. */
  content: string;
  /** Short note recorded on the event log. */
  reason?: string;
  /**
   * Required to proceed on a high-blast-radius write (e.g. a fan-out
   * source node). Call first without confirm to get `preview`, then
   * re-call with confirm=true to apply.
   */
  confirm?: boolean;
}

export interface WriteNodeContentResponse {
  ok: boolean;
  /**
   * 'written' — the edit was applied. 'preview' — high blast radius;
   * nothing written, `preview` holds the warning + `confirm` re-call
   * is needed.
   */
  status?: 'written' | 'preview';
  /** status='written' — relative path that was overwritten. */
  outputPath?: string;
  /** status='written' — downstream instance keys invalidated by the edit. */
  invalidatedKeys?: string[];
  /** status='preview' — the blast-radius warning to show the user. */
  preview?: string;
  /** Set when ok=false. */
  error?: string;
}

export interface ResolveBundleResponse {
  ok: boolean;
  bundle?: {
    id: string;
    version: string;
    description?: string;
    goal: string;
    nodes: Array<{
      id: string;
      kind: 'stage' | 'collection';
      /** Bundle-declared human label for this stage (e.g. "Shots"); falls back to a humanized id. */
      displayName?: string;
      displayCapability?: string;
      /**
       * Optional dot-path into the node's JSON output naming the field
       * the Inspector Canvas renders as the per-tile headline. Ignored
       * for non-json kinds. See dhee-core NodeDef.headlineField.
       */
      headlineField?: string;
      /**
       * Fan-out source for a `collection` node — the upstream node id whose
       * output it iterates. With `itemKey`, lets the run cockpit compute a
       * stable expected total (how many items WILL be produced) instead of
       * the lazily-materialized instance count. See dhee-core NodeDef.
       */
      itemSource?: string;
      /**
       * The array field, inside `itemSource`'s JSON output, this collection
       * fans out over (e.g. "shots" vs "scenes"). Bundle-agnostic: the
       * cockpit reads `sourcePlan[itemKey].length` — no node names baked in.
       */
      itemKey?: string;
      outputs: { format: string; pattern: string };
      /**
       * Upstream dependencies — used by the Inspector Canvas to draw
       * edges. Each entry's `from` is the upstream bundle node id.
       * The bridge always populates this field (empty array when the
       * node declares no inputs) so consumers can treat it as
       * non-null, but it's typed as optional here to preserve back-
       * compat with renderer-side fixtures that omit it.
       */
      inputs?: BundleNodeInputRef[];
    }>;
    display?: BundleDisplay;
  };
  /** Set when ok=false. */
  error?: string;
}
