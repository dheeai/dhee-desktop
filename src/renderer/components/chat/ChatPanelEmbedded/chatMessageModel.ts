/**
 * The chat transcript's internal message model.
 *
 * This is the *renderer-side* shape the chat panel keeps in state — richer
 * than the persisted/wire `ChatMessage` in `shared/chatTypes` and richer than
 * the legacy `types/chat.ts` shape. It carries the per-kind fields the UI
 * needs to render each entry first-class (tool call + result, progress lines,
 * reasoning traces, media, interactive pickers, run notices).
 *
 * Lifted out of `ChatPanelEmbedded.tsx` so the pure presentation helpers
 * (toolPresentation, coalesceTranscript, activityState) and the new
 * presentational components can import the type without pulling in the
 * 2600-line panel component.
 */

export type Role =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'system'
  | 'media'
  | 'question'
  | 'phase'
  | 'progress'
  | 'thinking'
  | 'bundle-choices'
  | 'question-card';

export type ToolStatus = 'in_progress' | 'completed' | 'error';

export interface ChatMessage {
  id: string;
  role: Role;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: ToolStatus;
  toolArgsSummary?: string;
  /**
   * Raw tool-call arguments, captured so the UI can render a tool card
   * first-class — e.g. the node/item/input the tool acted on becomes the
   * card's object sub-label. Populated on the `tool_call` event.
   */
  toolArgs?: Record<string, unknown>;
  /**
   * Structured `details` object from the tool result (e.g. critique's
   * affectedNodes, check_workflow's missing_refs, check_resolution's stale
   * list). Populated on `tool_result`; shape varies per tool, so the
   * per-archetype card body reads it defensively.
   */
  toolDetails?: Record<string, unknown>;
  /** The tool result's text content (parsed for counts / versions / etc.). */
  toolResultText?: string;
  /**
   * For role='progress' rows: the toolCallId of the originating tool
   * (e.g. dhee_run_to). One row per stream_chunk event so each
   * `[info] [N/M] Working on…` line is its own discrete block in the
   * chat — easier to scan than the previous "all concatenated into
   * one giant <pre> blob" rendering.
   */
  progressForToolCallId?: string;
  /** For role='progress' rows: the line itself (already trimmed). */
  progressText?: string;
  /**
   * For role='thinking' rows: the originating tool's call id. Used to
   * group consecutive reasoning chunks emitted under the same tool
   * invocation into a single growing thinking block.
   */
  thinkingForToolCallId?: string;
  /** For role='thinking' rows: the accumulated reasoning text. */
  thinkingText?: string;
  mediaKind?: 'image' | 'video';
  mediaPath?: string;
  mediaProject?: string;
  /**
   * Optional ms-timestamp from the tool's `details.created_at` (or
   * mtime). Threaded into the file:// URL as `?v=<key>` so the
   * Electron renderer fetches fresh bytes when the canonical
   * artifact has been overwritten since the bubble was first
   * created. Without this, the browser keeps serving the cached
   * first-version bytes and the user sees the "old mangled hands."
   */
  mediaCreatedAt?: number;
  /** Streaming bubbles aren't yet finalized; agent_response replaces text. */
  streaming?: boolean;
  /** agent_question fields */
  question?: string;
  options?: string[];
  defaultOption?: string;
  answered?: boolean;
  /**
   * For role='system' rows emitted from the executor's `notification`
   * event: the severity level (info / warning / error). When set to
   * 'error' the renderer styles the pill as a red error card so the
   * user notices ComfyUI / LLM failures instead of skimming past them
   * as ordinary system messages.
   */
  notificationLevel?: 'info' | 'warning' | 'error';
  /**
   * For role='bundle-choices' rows: bundle ids the agent offered via
   * dhee_present_bundle_choices, with display metadata. Renderer turns
   * each into a clickable card; click sends `Use <bundleId>` as the
   * next user message. `ids` is preserved as the canonical wire id;
   * `bundles` carries the displayName/summary the picker shows.
   */
  bundleChoices?: {
    ids: string[];
    bundles?: Array<{ id: string; displayName: string; summary: string }>;
    question?: string;
  };
  /** Set true once user clicked one of the choices — disables remaining cards. */
  bundleChoiceMade?: string | null;
  /**
   * For role='question-card' rows: a generic agent question rendered
   * as a clickable card grid via dhee_ask_question. `answered` holds
   * the user's picks (joined into the user message when sent).
   */
  questionCard?: {
    question: string;
    options: Array<{ id: string; label: string; description?: string }>;
    multiSelect: boolean;
  };
  /** Picked option ids for a question-card; null until the user submits. */
  questionCardAnswered?: string[] | null;
}
