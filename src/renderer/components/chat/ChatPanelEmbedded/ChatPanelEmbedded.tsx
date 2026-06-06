/**
 * ChatPanelEmbedded — chat UI built directly on the typed
 * `window.dhee.*` IPC surface (via `useDheeSession`).
 *
 * Display rules:
 *   - User messages: right-aligned bubble.
 *   - Assistant messages: rendered through react-markdown with GFM.
 *     Streamed via `stream_chunk` events into a single growing
 *     bubble (no flicker / no per-chunk new bubbles); finalised by
 *     `agent_response`.
 *   - Tool calls: compact one-liner with monospace name + status
 *     glyph. The same toolCallId is updated in place when its
 *     `tool_result` lands.
 *   - Inline media generated via `media_generated`.
 *   - Notifications: small system row.
 *   - agent_question: inline question prompt with option buttons.
 *   - phase_transition: phase banner system message.
 *   - context_usage: footer token-usage indicator.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  ArrowUp,
  ChevronDown,
  Download,
  Loader2,
  Paperclip,
  X,
} from 'lucide-react';
import type { Attachment } from '../../../../shared/attachmentTypes';
import AttachmentChip from '../ChatInput/AttachmentChip';
import styles from './ChatPanelEmbedded.module.scss';
import { findCanonicalAssistantBubbleIdx } from './findCanonicalBubble';
import { extractToolResultFilePath, cacheBustMediaSrc, resolveMediaSrc } from './mediaResolution';
import { useDheeSession } from '../../../hooks/useDheeSession';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useAgent } from '../../../contexts/AgentContext';
import { useChatQuestions } from '../../../contexts/ChatQuestionsContext';
import { useOptionalFirstRunTour } from '../../../contexts/FirstRunTourContext';
import type { dheeEvent } from '../../../../shared/dheeIpc';
import type { PersistedChatMessage } from '../../../../shared/chatTypes';
import { postChatNotice, subscribeChatNotices } from '../../../utils/chatNotices';
import {
  classifyProjectState,
  type ProjectLifecycleState,
} from './classifyProjectState';
import ProjectCTA, { type CTAAction } from './ProjectCTA';
import ProjectRunButton from './ProjectRunButton';

type Role =
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
type ToolStatus = 'in_progress' | 'completed' | 'error';

interface ChatMessage {
  id: string;
  role: Role;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: ToolStatus;
  toolArgsSummary?: string;
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

interface ContextUsage {
  used: number;
  limit: number;
}

type MessageListItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'progressGroup'; id: string; rows: ChatMessage[] };

let nextMessageId = 1;
function newMessageId(): string {
  return `msg-${nextMessageId++}`;
}

/**
 * How often to poll `window.dhee.runnerStatus()` for the active
 * task. The runner is the single source of truth for whether a long
 * pipeline is in flight; this poll interval bounds how quickly the
 * header Stop button appears/disappears in response to runner state
 * changes. 1500ms is a reasonable trade-off — fast enough that the
 * user perceives Stop appearing "right after" they hit Resume, slow
 * enough that we don't flood the IPC layer.
 */
const RUNNER_STATUS_POLL_MS = 1500;

/**
 * Defense-in-depth for the "silent run" bug. The real fix is making
 * regenerate runs dispatch through the BackgroundTaskRunner so
 * `runnerStatus()` reflects them (that poll is the authoritative,
 * continuous signal). This is a secondary backstop: a `media_generated`
 * event proves a node just produced output, so we keep the indicator
 * lit briefly after one in case a run surfaces media before the next
 * poll catches it (or via some future event-emitting path that
 * `runnerStatus` misses). `media_generated` is used — not
 * tool_call/result — because only renders emit it, so it can't
 * false-positive on ordinary agent file tools (bash/read/edit). Kept
 * short so it merely bridges poll latency and never lingers noticeably
 * after a run ends.
 */
const RENDER_ACTIVITY_TTL_MS = 4_000;

/**
 * Cap on the "Still cancelling…" notice loop. The main process force-
 * resets a wedged session after ~90s; this is a renderer backstop so
 * the notice can't count up indefinitely if that signal is missed.
 * Comfortably larger than the 90s watchdog.
 */
const CANCEL_NOTICE_CAP_SEC = 180;

/**
 * Detect the "text concatenated with itself" pattern that the
 * upstream LLM stream sometimes produces (e.g. an entire multi-
 * paragraph response repeated twice in a single bubble) and return
 * just the first half.
 *
 * The bug's symptom in the wild is always paragraph-length+ — so
 * we set a generous minimum length (120 chars) to avoid
 * false-positive collapses on legitimate short repetitions like
 * "Yes! Yes!" or "ha ha ha ha". Above that threshold, an even-
 * length string whose first half is byte-identical to the second
 * half is overwhelmingly the bug, not real content.
 */
/**
 * Pull every `<thinking>…</thinking>` body out of a stream chunk and
 * concatenate them. Streaming sometimes splits a single thinking block
 * across multiple chunks (open tag in one, body in the next, close tag
 * later) — we cope by also accepting "no close tag" content as
 * thinking-in-progress when the preceding text was already inside a
 * thinking block. For simplicity, the executor wraps each emitted
 * thinking fragment in its own pair of tags, so the multi-fragment
 * case is rare in practice.
 */
function extractThinkingText(chunk: string): string {
  if (!chunk.includes('<thinking>') && !chunk.includes('</thinking>'))
    return '';
  const matches = chunk.match(/<thinking>([\s\S]*?)<\/thinking>/g) ?? [];
  return matches
    .map((m) => m.replace(/^<thinking>/, '').replace(/<\/thinking>$/, ''))
    .join('');
}

/**
 * Remove every `<thinking>…</thinking>` (including any open tag with no
 * matching close, defensively) so the residual chunk can fall through
 * to the regular progress-row path without spilling reasoning into
 * the tool log.
 */
function stripThinkingTags(chunk: string): string {
  return chunk
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<thinking>[\s\S]*$/, '');
}

function dedupeDoubled(text: string): string {
  const len = text.length;
  if (len < 120 || len % 2 !== 0) return text;
  const half = len / 2;
  if (text.slice(0, half) === text.slice(half)) {
    return text.slice(0, half);
  }
  return text;
}

function mergeStreamText(
  prev: string | undefined,
  chunk: string,
  done?: boolean,
): string {
  const base = prev ?? '';
  if (!chunk) return done ? base : base;

  // If the stream occasionally re-sends the last few chars, avoid
  // visible duplication by trimming the largest suffix/prefix overlap.
  const maxOverlap = Math.min(base.length, chunk.length, 64);
  for (let i = maxOverlap; i > 0; i -= 1) {
    if (base.slice(-i) === chunk.slice(0, i)) {
      return base + chunk.slice(i);
    }
  }
  return base + chunk;
}

function groupConsecutiveProgress(messages: ChatMessage[]): MessageListItem[] {
  const items: MessageListItem[] = [];
  let pendingRows: ChatMessage[] = [];

  const flushProgress = () => {
    if (pendingRows.length === 0) return;
    items.push({
      kind: 'progressGroup',
      id: `progress-${pendingRows[0].id}`,
      rows: pendingRows,
    });
    pendingRows = [];
  };

  for (const message of messages) {
    if (message.role === 'progress') {
      pendingRows.push(message);
      continue;
    }

    flushProgress();
    items.push({ kind: 'message', message });
  }

  flushProgress();
  return items;
}

// Moved to ./mediaResolution.ts (with URL encoding fix — see comment in
// resolveMediaSrc there). The unit tests live in mediaResolution.test.ts.

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  // Show every arg, full value. Tool card CSS handles wrapping for long
  // strings; chopping in JS made debugging impossible (paths got cut
  // mid-folder, prompts cut mid-word, etc.). The summary feeds tool-card
  // display only — it's not used for any matching / parsing logic.
  const parts = entries.map(([k, v]) => {
    let value = '';
    if (typeof v === 'string') value = v;
    else if (typeof v === 'number' || typeof v === 'boolean') value = String(v);
    else value = JSON.stringify(v);
    return `${k}=${value}`;
  });
  return parts.join(' ');
}

/**
 * Extract the text body of a pi tool result regardless of shape.
 *
 * The pi tool's execute() returns `content: [{type:'text', text}]`, but
 * the main process flattens that to a plain string before forwarding to
 * the renderer (see dheeCoreManager's tool_execution_end mapping). The
 * picker parsers (bundle_choices / question_choices) need the raw text
 * either way, so accept both shapes and return '' when neither matches.
 */
function toolResultText(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.find((c) => c?.type === 'text')?.text ?? '';
  }
  return '';
}

export default function ChatPanelEmbedded() {
  const session = useDheeSession();
  const { projectName, projectDirectory } = useWorkspace();
  const firstRunTour = useOptionalFirstRunTour();
  const agent = useAgent();
  const chatQuestions = useChatQuestions();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatAttachments, setChatAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // Header dropdown menu (project name → caret → menu) state.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Re-hydrate on every mount ─────────────────────────────────────
  // When the user navigates away (e.g. to Settings) and comes back,
  // this component is fully unmounted — `messages` state is lost. The
  // DheeSessionProvider stays alive at app root so the session id
  // survives, but its `history` snapshot was already consumed by the
  // previous mount. Refetch from disk (the source of truth) on every
  // mount; the hydration effect below then re-seeds the panel.
  useEffect(() => {
    if (!session.sessionId) return;
    void session.refreshHistory();
  }, [session.sessionId, session.refreshHistory]);

  // When the backend session is REPLACED (e.g., a "New chat" / new
  // project create called `clearChatHistory`, which mints a fresh
  // sessionId and wipes the on-disk JSONL), wipe the local message
  // state so the previous session's bubbles don't visually leak into
  // the new conversation. Without this, NewProjectDialog's chat reset
  // would clear the server-side history but the renderer would keep
  // rendering the old bubbles until next reload (the 2026-05-19
  // Village → Soft Seinen visible-carryover bug).
  //
  // Tracked via a ref so the FIRST sessionId assignment (null → "abc")
  // doesn't trigger a reset — there's nothing to clear at that point.
  const previousSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const current = session.sessionId;
    const prev = previousSessionIdRef.current;
    if (prev && current && prev !== current) {
      setMessages([]);
      setContextUsage(null);
    }
    previousSessionIdRef.current = current;
  }, [session.sessionId]);

  // ── Resume hydration ──────────────────────────────────────────────
  // When `session.history` is set (either from initial resume or from
  // a `refreshHistory()` call above), translate it into local
  // ChatMessage rows so the panel renders the prior conversation as if
  // it had been streamed live. One-shot: consumeHistory() reads-and-
  // clears, so a later refresh-driven update of the same content
  // doesn't double-seed.
  useEffect(() => {
    if (!session.sessionId) return;
    if (!session.history) return;
    const snap = session.consumeHistory();
    if (!snap) return;

    type Row = { ts: number; msg: ChatMessage };
    const rows: Row[] = [];

    for (const m of snap.messages) {
      const ts = m.timestamp || Date.now();
      if (m.type === 'media' && m.media) {
        rows.push({
          ts,
          msg: {
            id: m.id,
            role: 'media',
            mediaKind: m.media.kind,
            mediaPath: m.media.path,
            mediaProject: m.media.project,
          },
        });
        continue;
      }
      const role: ChatMessage['role'] =
        m.type === 'user'
          ? 'user'
          : m.type === 'agent'
            ? 'assistant'
            : 'system';
      rows.push({
        ts,
        msg: { id: m.id, role, text: m.content },
      });
    }

    for (const tc of snap.toolCalls) {
      const ts = tc.startTime || Date.now();
      const status: ToolStatus =
        tc.status === 'executing'
          ? 'in_progress'
          : tc.status === 'error'
            ? 'error'
            : 'completed';
      const argsSummary = tc.args
        ? Object.entries(tc.args)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
            .slice(0, 200)
        : undefined;
      rows.push({
        ts,
        msg: {
          id: tc.id,
          role: 'tool',
          toolName: tc.toolName,
          toolCallId: tc.id,
          toolStatus: status,
          ...(argsSummary ? { toolArgsSummary: argsSummary } : {}),
        },
      });
    }

    rows.sort((a, b) => a.ts - b.ts);
    setMessages(rows.map((r) => r.msg));
  }, [session.sessionId, session.history, session.consumeHistory]);

  // ── New-project wizard state ──────────────────────────────────────
  // Auto-spawns when the user opens an unconfigured project. Collects
  // style → duration → story; on confirm, calls session.configureProject
  // (persists template/style/duration into project.json) then runs a
  // kickoff task that pi-agent routes to `dhee_new` with `existingDir`.
  // Surface system-style receipts pushed by other panels (e.g., the
  // Prompts tab's edit-and-invalidate flow) into the chat history. The
  // text is UI-only — the agent doesn't read it; on-disk state already
  // reflects the edit + invalidation by the time this fires.
  useEffect(() => {
    if (!agent) return undefined;
    return agent.registerNotifyChatReceipt((text) => {
      setMessages((prev) => [
        ...prev,
        { id: newMessageId(), role: 'system', text },
      ]);
    });
  }, [agent]);

  // Expose this session's invalidateNodes so other panels (Prompts tab)
  // can drive backend invalidation through the same chat session.
  useEffect(() => {
    if (!agent) return undefined;
    return agent.registerInvalidateNodes((nodeIds) =>
      session.invalidateNodes(nodeIds),
    );
  }, [agent, session]);

  // True once project.json with bundleSource has been observed for the
  // current project (i.e. a bundle is pinned). When false AND probe
  // is complete, we treat the project as fresh and hand off to the
  // agent-led onboarding flow.
  const [isSetupConfigured, setIsSetupConfigured] = useState(false);
  // Whether we've already finished the "is this project fresh?" probe.
  // Until this flips true the onboarding effect mustn't fire,
  // otherwise it'd dispatch a greeting before we know whether one is
  // needed.
  const [setupProbeCompleted, setSetupProbeCompleted] = useState(false);
  // Classified lifecycle state for the active project. Drives whether
  // we render a contextual CTA (in_progress / completed) in the empty
  // chat area.
  const [projectState, setProjectState] = useState<ProjectLifecycleState | null>(
    null,
  );
  // Bump to force a re-probe of project.json after a kshana_* tool
  // mutates the lifecycle-relevant fields (style/templateId/duration/
  // goal.status). Without this, projectState gets stuck at whatever
  // the probe saw on initial mount — e.g. if the New Project Dialog
  // wrote an empty project.json and dhee_new filled it in later,
  // the probe never re-sees the now-configured state, ProjectRunButton
  // stays hidden, and the user has no run/resume CTA. See
  // toolDidMutateLifecycle() below for the tool allowlist.
  const [probeNonce, setProbeNonce] = useState(0);
  // Local "I clicked stop, waiting for the abort to land" flag. The
  // cancel signal takes a beat to propagate through pi-agent → the
  // executor → ComfyUI / LLM clients. Without immediate visual
  // feedback the user assumes the click was ignored. Cleared when
  // bgStatus leaves 'running'.
  const [pendingCancel, setPendingCancel] = useState(false);

  // ── Background task runner integration ───────────────────────────
  //
  // dhee_run_to (and the upcoming dhee_regen / render_scene_bundle
  // dispatch tools) are now non-blocking on the dhee-core side —
  // every call goes through the BackgroundTaskRunner singleton which
  // detaches execution from the agent's tool-call loop. The renderer
  // doesn't need a separate session anymore: pi-agent on the MAIN
  // session calls the dispatch tool, returns immediately, and the
  // runner's progress events flow back through the same session id.
  //
  // We keep `bgSessionId` as state for now so the rest of the panel's
  // wiring (header Run/Stop button, status pill) can read it; it
  // points at the main session id once available, used purely as a
  // route key for cancel.
  const [bgSessionId, setBgSessionId] = useState<string | null>(null);
  // Whether the BackgroundTaskRunner reports an active task. Polled
  // from `window.dhee.runnerStatus()` — see the effect below. This
  // is the SINGLE source of truth for the header Stop button, so the
  // button reflects reality regardless of which tool pi-agent fired
  // to start the run.
  const [runnerActive, setRunnerActive] = useState(false);

  // Stop-after-each-collection gate. Per-project: mirrors
  // `features.gateAfterCollections` in the active project's
  // project.json. Read by the probe effect below; toggled by the
  // header button (which read-modify-writes project.json). When on,
  // dhee-core's walker halts after each collection node so the user
  // can inspect that batch before resuming. See
  // dhee-core docs/feature-flags.md.
  const [gateAfterCollections, setGateAfterCollections] = useState(false);

  // Tracks the id of the currently-streaming assistant message so
  // multiple `stream_chunk` events accumulate into one bubble instead
  // of creating a new bubble per chunk.
  const streamingMsgIdRef = useRef<string | null>(null);
  // toolCallId → toolName lookup, populated on tool_call and cleared
  // on tool_result. We use it in the stream_chunk handler to filter:
  // only the long-running dhee_* tools (dhee_run_to in
  // particular) surface their per-line progress in the chat. Internal
  // pi-agent tool output (bash, read, edit, grep …) gets dropped so
  // the chat doesn't get flooded with file listings and grep
  // results.
  const toolNameByCallIdRef = useRef<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // Timestamp of the last render `asset` event — used as a defense-in-
  // depth running signal (see RENDER_ACTIVITY_TTL_MS).
  const lastRenderEventRef = useRef<number>(0);

  useEffect(() => {
    if (!session.sessionId) return;
    const mainId = session.sessionId;
    const unsubscribe = session.subscribe('*', (event: dheeEvent) => {
      // Accept the main session — and any event without an
      // explicit sessionId (the BackgroundTaskRunner detaches from
      // the agent's tool-call loop and historically routed progress
      // through `backgroundEvents`, whose payloads sometimes carry
      // no/different sessionId). Previously this filter also accepted
      // `bgSessionId`, but per the architecture comment above
      // (`pi-agent on the MAIN session calls the dispatch tool,
      // returns immediately, and the runner's progress events flow
      // back through the same session id`), the bg-id branch is now
      // legacy and was silently dropping pi-agent's autonomous-mode
      // commentary live (visible only after remount via JSONL
      // hydration). Permissive filter — match anything for the main
      // session OR with an unset session id; reject only events
      // explicitly tagged for a different session.
      const sid = event.sessionId;
      if (sid && sid !== mainId && sid !== bgSessionId) {
        return;
      }
      // Defense-in-depth running signal: a `media_generated` event means
      // a node actually rendered something. Stamp the time so the
      // indicator stays lit even if `runnerStatus` somehow doesn't
      // reflect the run.
      if (event.eventName === 'media_generated') {
        lastRenderEventRef.current = Date.now();
      }
      // The header Stop button is no longer driven by tool-name
      // sniffing here. The previous tool-name allowlist
      // (`LONG_RUNNING_dhee_TOOLS`) only flipped on for THREE
      // hard-coded names — any other path pi-agent took to
      // generate a project left the button hidden for the entire
      // run. Now `runnerStatus()` (polled below) is the single
      // source of truth: if the BackgroundTaskRunner reports a
      // task active, the button shows. See the
      // `runnerActive` poll effect below.
      handleEvent(
        event,
        setMessages,
        streamingMsgIdRef,
        setContextUsage,
        toolNameByCallIdRef,
        setProbeNonce,
      );
    });
    return unsubscribe;
  }, [session.sessionId, session.subscribe, bgSessionId]);

  // Renderer-side chat-notice bus: lets sibling components (Redo
  // menu, settings, future per-shot edit flow…) post an ephemeral
  // chat-window status row without going through pi-agent or the
  // IPC event stream. Notices render as 'system' rows alongside the
  // server-side `notification` events from `🛑 stop` etc. They are
  // NOT persisted to JSONL — on remount they vanish, same as the
  // server-side ephemeral notifications.
  useEffect(() => {
    const unsubscribe = subscribeChatNotices((notice) => {
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'system',
          text:
            notice.level === 'info'
              ? notice.message
              : `[${notice.level}] ${notice.message}`,
          notificationLevel: notice.level,
        },
      ]);
    });
    return unsubscribe;
  }, []);

  // Poll runnerStatus to drive `runnerActive`. The runner emits no
  // push events to the renderer today (only `runnerStatus` /
  // `runnerCancel` IPC), so polling is the path. An immediate fetch
  // happens on mount so a user who reopens the panel mid-run sees
  // Stop without waiting for the first interval tick.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await window.dhee.runnerStatus();
        if (cancelled) return;
        // Authoritative signal OR a recent render-asset window. The
        // poll owns turning it OFF (so it can't stick on); the asset
        // window catches any run that doesn't surface via runnerStatus.
        const recentRender = Date.now() - lastRenderEventRef.current < RENDER_ACTIVITY_TTL_MS;
        setRunnerActive(!!status?.active || recentRender);
        // Mirror server-side `cancelling` into local pendingCancel.
        // This is what makes pi-agent's `dhee_task_cancel` (and any
        // other non-UI cancel path) flip the button to "Stopping…"
        // — previously pendingCancel was only set in handleCancel(),
        // so an agent-initiated cancel left the button on "Stop"
        // for the entire wind-down. We only PROMOTE here (never
        // demote): the existing effect at line ~613 that clears
        // pendingCancel once both lanes go idle is still the only
        // path that flips it back to false, so we don't race.
        if (status?.cancelling) {
          setPendingCancel((prev) => (prev ? prev : true));
        }
      } catch {
        if (!cancelled) setRunnerActive(false);
      }
    };
    tick();
    const handle = setInterval(tick, RUNNER_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  // Clear the local "Stopping…" flag once BOTH execution lanes report
  // idle: the BackgroundTaskRunner AND the pi-agent chat session.
  // If we cleared it on runnerActive alone, a chat-only stop (where
  // the runner was never active) would flip the button back to Resume
  // immediately — before pi-agent had finished aborting in-flight
  // tool calls.
  useEffect(() => {
    const chatBusy = session.status === 'running';
    if (!runnerActive && !chatBusy && pendingCancel) {
      setPendingCancel(false);
    }
  }, [runnerActive, pendingCancel, session.status]);

  // Periodic chat notice while cancel is pending. LLM and ComfyUI
  // calls don't always honor mid-stream aborts (the provider may
  // ignore client disconnects, or the request is already buffered on
  // the wire), so a Stop click can sit at "Stopping…" for 30–90s
  // while the in-flight call returns. Without status updates the user
  // is left guessing whether the click was registered at all. Every
  // 15s we report which lane is still busy and surface the last
  // observable activity (most recent progress chunk or in-progress
  // tool name) so the user can see what specifically is blocking the
  // cancel — e.g. "scene expansion LLM call" vs "Klein image render".
  //
  // First post fires at 15s (not on click) so quick cancels that
  // finish in 1–2s stay silent. The notice channel is the ephemeral
  // chat-notice bus, so reload clears the history with no persistence.
  const cancelStatusRef = useRef<{
    runnerActive: boolean;
    chatBusy: boolean;
    messages: ChatMessage[];
  }>({
    runnerActive: false,
    chatBusy: false,
    messages: [],
  });
  // Keep the ref synced with current state on every render so the
  // interval callback (which captures the ref, not the state) reads
  // fresh values without us having to recreate the interval each
  // time runnerActive / session.status / messages change.
  cancelStatusRef.current = {
    runnerActive,
    chatBusy: session.status === 'running',
    messages,
  };
  useEffect(() => {
    if (!pendingCancel) return;
    const startedAt = Date.now();
    const handle = setInterval(() => {
      const state = cancelStatusRef.current;
      if (!state.runnerActive && !state.chatBusy) return; // clearing imminent — skip
      // Backstop: the main process force-resets a wedged session after
      // ~90s (returning control). If for any reason that signal never
      // reaches us, stop spamming after this cap and tell the user how
      // to recover, rather than counting up forever (the 7h "Still
      // cancelling…" wall).
      const elapsedCapSec = Math.round((Date.now() - startedAt) / 1000);
      if (elapsedCapSec >= CANCEL_NOTICE_CAP_SEC) {
        postChatNotice({
          level: 'warning',
          message:
            `Stop has been pending ${elapsedCapSec}s — the in-flight call isn't releasing the lock. ` +
            `It should auto-reset shortly; if the chat stays locked, reload the window (⌘R) to recover.`,
        });
        clearInterval(handle);
        return;
      }
      const lanes: string[] = [];
      if (state.runnerActive) lanes.push('the pipeline runner');
      if (state.chatBusy) lanes.push('the chat session');
      const lanesText =
        lanes.length === 2
          ? 'the pipeline runner and the chat session'
          : (lanes[0] ?? 'in-flight work');
      // Most recent progress chunk text is the strongest signal of
      // what the runner was last seen doing (e.g. "Expanded
      // Characters: …", "Generating image for shot 3"). Walk back
      // a small window so we don't scan the entire history.
      const recentProgress = state.messages
        .slice(-30)
        .reverse()
        .find(
          (m) =>
            m.role === 'progress' &&
            ((m.progressText && m.progressText.trim()) ||
              (m.text && m.text.trim())),
        );
      const lastObserved = recentProgress
        ? (recentProgress.progressText ?? recentProgress.text ?? '')
            .trim()
            .slice(0, 140)
        : '';
      // Fallback: name the in-progress tool card (usually
      // dhee_run_to wrapping the whole pipeline).
      const inProgressTool = state.messages
        .slice(-10)
        .reverse()
        .find((m) => m.role === 'tool' && m.toolStatus === 'in_progress');
      let detail = '';
      if (lastObserved) {
        detail = ` Last observed: "${lastObserved}".`;
      } else if (inProgressTool?.toolName) {
        detail = ` In-progress tool: \`${inProgressTool.toolName}\`.`;
      }
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      postChatNotice({
        level: 'info',
        message: `Still cancelling (${elapsedSec}s). Waiting for ${lanesText} to release the lock.${detail} Cancel only fires at safe checkpoints between LLM/ComfyUI calls — mid-stream aborts are not always honored upstream. Typical wait: 30–90s.`,
      });
    }, 15000);
    return () => clearInterval(handle);
  }, [pendingCancel]);

  // (was: bg-session teardown on project switch — no longer needed
  // since the BackgroundTaskRunner singleton handles task lifecycle
  // independent of session lifetime).

  useEffect(() => {
    if (!session.sessionId || !projectName) return;
    // Pass the absolute project directory so the embedded core
    // looks in the same parent the user opened from — even when
    // that's outside the dhee-ink package's default getProjectsDir().
    //
    // Phase 6.5c.d: refreshHistory ONCE focusProject has mapped the
    // session → projectDir on the main side. Without this chained
    // refresh, the earlier mount-time refreshHistory call (line ~300)
    // races focusProject and the main side has no projectDir yet, so
    // the JSONL never rehydrates into the chat panel.
    let cancelled = false;
    session
      .focusProject(projectName, projectDirectory ?? undefined)
      .then(() => {
        if (cancelled) return;
        return session.refreshHistory();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session.sessionId, projectName, projectDirectory, session.focusProject, session.refreshHistory]);

  useEffect(() => {
    firstRunTour.notifyTourEvent('chat_visible');
  }, [firstRunTour]);

  // Auto-scroll to the latest message. (jsdom in tests omits scrollIntoView.)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages]);

  // Click-outside handler for the project header dropdown menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onMouseDown = (event: MouseEvent) => {
      if (
        menuWrapperRef.current &&
        !menuWrapperRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [menuOpen]);

  // Compute a friendly project label for the header.
  const headerProjectName = projectName?.trim() || 'No project open';

  // Project-switch reset: clears probe-derived state the moment the
  // user opens a different project, so a stale 'in_progress' from the
  // previous project doesn't flash before the new probe lands.
  // Deliberately separated from the probe effect below so that a
  // probeNonce bump (re-probe on the SAME project) doesn't flicker the
  // button to nothing for a tick.
  useEffect(() => {
    setSetupProbeCompleted(false);
    setIsSetupConfigured(false);
    setProjectState(null);
  }, [projectDirectory]);

  // Probe project.json to decide whether this project still needs the
  // setup wizard. Runs every time the user opens a different project,
  // AND whenever `probeNonce` is bumped by a tool result that mutated
  // the project's lifecycle-relevant fields.
  useEffect(() => {
    if (!projectDirectory) return;
    let cancelled = false;
    const reader = {
      readFile: (p: string) => window.electron.project.readFile(p),
    };
    (async () => {
      // "Is this project pinned to a bundle yet?" — the only thing we
      // need to know from project.json. If yes → don't dispatch the
      // onboarding greeting; the agent picks up where the user left off.
      let hasBundle = false;
      // Strict boolean — only the literal `true` enables, matching the
      // dhee-core reader (src/dag/projectFeatures.ts).
      let gateOn = false;
      try {
        const raw = await reader.readFile(`${projectDirectory}/project.json`);
        if (typeof raw === 'string' && raw.length > 0) {
          const pj = JSON.parse(raw) as {
            bundleSource?: unknown;
            features?: { gateAfterCollections?: unknown };
          };
          hasBundle = typeof pj.bundleSource === 'string' && pj.bundleSource.length > 0;
          gateOn = pj.features?.gateAfterCollections === true;
        }
      } catch {
        hasBundle = false;
      }
      const lifecycle = await classifyProjectState(projectDirectory, reader);
      if (cancelled) return;
      setIsSetupConfigured(hasBundle);
      setProjectState(lifecycle);
      setGateAfterCollections(gateOn);
      setSetupProbeCompleted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDirectory, probeNonce]);

  // Click handler for any CTA action: dispatch the pre-baked task as
  // a chat message so it's visible in the user's history (matching
  // typed-input behaviour).
  const handleCTAAction = useCallback(
    async (action: CTAAction) => {
      if (!session.sessionId) return;
      // Compact system bubble instead of dumping the verbose
      // pre-baked task text. Each CTA carries a human-friendly
      // `label` ("Continue the pipeline", "Show me the final video"
      // …) which is what we want the user to see.
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'system',
          text: action.label,
        },
      ]);
      streamingMsgIdRef.current = null;
      await session.runTask(action.task);
    },
    [session],
  );

  // Whether we've already kicked off the agent-led onboarding for the
  // current fresh project. Without this guard the effect would fire on
  // every render (and dispatch a fresh greeting every time the user
  // typed something), spamming the agent.
  const onboardingDispatchedRef = useRef<string | null>(null);

  // Fresh projects: skip the legacy form wizard, dispatch an agent
  // greeting instead. The agent's SKILL.md has an "Onboarding a fresh
  // project" section that instructs it to ask one short question, wait
  // for the story, call `dhee_list_bundles`, pick the right bundle,
  // and call `dhee_create_project(existingDir=…)` + `dhee_run_bundle`.
  useEffect(() => {
    // Fire ONLY when: a project is focused, the probe finished, the
    // project has no bundle pinned (fresh), and the session is ready.
    if (!projectDirectory) return;
    if (!setupProbeCompleted) return;
    if (isSetupConfigured) return;
    if (!session.sessionId) return;
    if (onboardingDispatchedRef.current === projectDirectory) return;

    onboardingDispatchedRef.current = projectDirectory;
    // Synthetic system kickoff. NOT rendered as a user bubble — the
    // user didn't type it. The agent reads it as context and produces
    // a greeting which lands as a normal assistant message via the
    // streaming events / end-of-turn fallback in handleSend below.
    const kickoff =
      `[system] User just opened a fresh project at ${projectDirectory} ` +
      `(no project.json yet). Greet them in one short sentence — "What ` +
      `are we making today?" — and wait for their story. When you ` +
      `eventually call dhee_create_project, pass existingDir="${projectDirectory}".`;
    void (async () => {
      // Ensure the session is focused on this project before the agent
      // dispatches any tool calls. Idempotent — safe to re-call even
      // if the main focus effect already ran.
      if (projectName) {
        await session.focusProject(projectName, projectDirectory).catch(() => undefined);
      }
      const r = await session.chatPrompt(kickoff);
      if (!r.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: newMessageId(),
            role: 'system',
            text: `Couldn't start onboarding: ${r.error ?? 'unknown error'}.`,
          },
        ]);
      }
    })();
  }, [
    projectDirectory,
    projectName,
    isSetupConfigured,
    setupProbeCompleted,
    session,
  ]);

  // Bundle-picker click → send "Use <bundleId>" as the next chatPrompt,
  // mark the chosen card so other cards in the same row grey out.
  const handleBundleChoiceClick = useCallback(
    (msgId: string, bundleId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.role === 'bundle-choices'
            ? { ...m, bundleChoiceMade: bundleId }
            : m,
        ),
      );
      void session.chatPrompt(`Use ${bundleId}`);
    },
    [session],
  );

  /**
   * Generic question-card click handler.
   *
   * Single-select: the click is the submit — pin the selection and
   * fire the chatPrompt with the picked option's label.
   *
   * Multi-select: the click toggles selection in state; only the
   * separate "Done" button (kind === 'submit') actually sends. The
   * sent message joins picked labels with ", ".
   */
  const handleQuestionCardClick = useCallback(
    (msgId: string, optionId: string, kind: 'toggle' | 'submit' | 'pick') => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || m.role !== 'question-card' || !m.questionCard) return m;
          if (m.questionCardAnswered && m.questionCardAnswered.length > 0
              && (kind === 'pick' || !m.questionCard.multiSelect)) {
            // Already submitted — ignore further clicks on a single-
            // select card that's been answered.
            return m;
          }
          const current = m.questionCardAnswered ?? [];
          if (kind === 'pick') {
            // Single-select: replace + send (send happens below).
            return { ...m, questionCardAnswered: [optionId] };
          }
          if (kind === 'toggle') {
            const next = current.includes(optionId)
              ? current.filter((x) => x !== optionId)
              : [...current, optionId];
            return { ...m, questionCardAnswered: next };
          }
          // 'submit' — keep the existing selection; renderer renders
          // the disabled state from questionCardAnswered being set.
          if (current.length === 0) return m;
          return m;
        }),
      );
      if (kind === 'toggle') return;
      // For 'pick' and 'submit' kinds, read the latest state and
      // dispatch the joined labels as the user's next message.
      queueMicrotask(() => {
        setMessages((prev) => {
          const target = prev.find((m) => m.id === msgId && m.role === 'question-card');
          if (!target || !target.questionCard) return prev;
          const picked = target.questionCardAnswered ?? [];
          if (picked.length === 0) return prev;
          const labels = picked.map((id) =>
            target.questionCard!.options.find((o) => o.id === id)?.label ?? id,
          );
          void session.chatPrompt(labels.join(', '));
          return prev;
        });
      });
    },
    [session],
  );

  const handleAttachClick = async () => {
    setAttachmentError(null);
    try {
      const result = await window.electron.project.selectAttachment({
        // Order matters: when a picked file's extension maps to
        // multiple kinds the IPC handler returns the FIRST listed
        // match. Images first so PNG/JPG don't get misclassified.
        kinds: ['image', 'comfy_workflow'],
        title: 'Attach an image or ComfyUI workflow',
      });
      if (!result.ok) {
        if (result.error) setAttachmentError(result.error);
        return;
      }
      if (result.attachment) {
        // v1 caps at one attachment per turn — keeps the skill
        // prompt's parsing simple. Lift this when batched flows
        // (e.g. multiple images at once) need it.
        setChatAttachments([result.attachment as Attachment]);
      }
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setChatAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSend = async () => {
    const text = input.trim();
    // A turn must have either text or at least one attachment.
    if ((!text && chatAttachments.length === 0) || !session.sessionId) return;
    firstRunTour.notifyTourEvent('chat_prompt_sent');

    // If pi-agent is mid-turn (e.g. running a multi-step regen +
    // bash + regen sequence), the user often wants to interject
    // with a clarification — "actually that won't work, do X
    // instead". The earlier behavior bounced this with a "please
    // wait" system message, which made the chat feel broken
    // ("non-interactive after the first message"). Cancel the
    // current turn and dispatch the new one instead.
    if (session.status === 'running') {
      await session.cancel().catch(() => undefined);
    }

    // Render the user-visible message — include a small "📎 N
    // attachment(s)" suffix when files were attached, so the chat
    // log reflects what was sent.
    const visibleText =
      chatAttachments.length > 0
        ? `${text}${text ? '\n\n' : ''}📎 ${chatAttachments.map((a) => a.name).join(', ')}`
        : text;

    setMessages((prev) => [
      ...prev,
      { id: newMessageId(), role: 'user', text: visibleText },
    ]);
    const sentAttachments = chatAttachments;
    setInput('');
    setChatAttachments([]);
    setAttachmentError(null);
    streamingMsgIdRef.current = null;

    // Phase 6.5c: chat input now drives pi-agent directly via
    // chatPrompt (NOT runTask, which is for bundle-runner dispatches —
    // Resume button etc.). One-shot exchange: send → wait → append
    // the assistant_text as a single bubble. Streaming + tool-call
    // surfacing comes in 6.5c.b. Attachments are not threaded through
    // chatPrompt yet — they continue working only when sent via the
    // Resume / runTask path. Surfaced as a system message for now so
    // the user knows.
    if (sentAttachments.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'system',
          text: 'Attachments aren\'t yet supported on the new chat path (Phase 6.5c.b). The text was sent; the attachment(s) were ignored.',
        },
      ]);
    }
    // Phase 6.5c.b: the agent's reply now streams via stream_chunk
    // events handled by handleEvent — the existing streamingMsgIdRef
    // path accumulates into a single bubble. We only need to surface
    // the END-OF-TURN summary if streaming produced nothing (e.g. the
    // provider returned tools-only or the model output was empty).
    const result = await session.chatPrompt(text);
    if (!result.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'system',
          text: `Couldn't reach the agent: ${result.error ?? 'unknown error'}.`,
        },
      ]);
      return;
    }
    const streamed = streamingMsgIdRef.current !== null;
    if (!streamed && result.assistant_text) {
      // Fallback: provider didn't emit text_delta events; show the
      // final envelope so the chat doesn't look broken.
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'assistant',
          text: result.assistant_text,
        },
      ]);
    }
    streamingMsgIdRef.current = null;
  };

  // Stop-after-each-collection: per-project flag persisted in the
  // active project's project.json (`features.gateAfterCollections`).
  // We read-modify-write the whole file so walkState and every other
  // field is preserved — only the one feature flag changes. Guarded by
  // `isRunning` at the call site (button disabled), so this write never
  // races the walker's own walkState writes. The walker reads the flag
  // once at the start of a run, so changing it only affects the NEXT
  // run regardless.
  const handleToggleGate = useCallback(async () => {
    if (!projectDirectory) return;
    const next = !gateAfterCollections;
    const jsonPath = `${projectDirectory}/project.json`;
    try {
      const raw = await window.electron.project.readFile(jsonPath);
      const pj =
        typeof raw === 'string' && raw.length > 0
          ? (JSON.parse(raw) as Record<string, unknown>)
          : {};
      const features = {
        ...(typeof pj.features === 'object' && pj.features
          ? (pj.features as Record<string, unknown>)
          : {}),
        gateAfterCollections: next,
      };
      const updated = { ...pj, features };
      await window.electron.project.writeFile(
        jsonPath,
        JSON.stringify(updated, null, 2),
      );
      setGateAfterCollections(next);
    } catch {
      // Leave the toggle as-is on failure; the next probe re-syncs it
      // from disk so the UI never drifts from project.json.
    }
  }, [projectDirectory, gateAfterCollections]);

  const handleCancel = useCallback(async () => {
    // Stop kills BOTH execution lanes:
    //   1. BackgroundTaskRunner (long pipeline tasks dispatched via
    //      dhee_run_to) — runnerCancel aborts the in-flight task and
    //      emits a 'cancelled' event back to the originating session.
    //   2. The pi-agent chat session itself — when pi is mid-reply
    //      (looping bash, edits, etc.) the user expects Stop to halt
    //      that too. Without session.cancel(), the chat keeps spamming
    //      tool calls while the spinner says "Stopping…".
    // Both calls are best-effort — failures here would just leave the
    // optimistic spinner on; the runnerActive poll will reset it.
    setPendingCancel(true);
    await Promise.all([
      window.dhee.runnerCancel().catch(() => undefined),
      session.cancel().catch(() => undefined),
    ]);
  }, [session]);

  // Build the "resume the pipeline" task and run it on the MAIN
  // session. dhee-core's pi-agent will receive it, call
  // dhee_run_to, which now dispatches to the BackgroundTaskRunner
  // and returns immediately — keeping this chat session free for
  // follow-up questions while the run streams progress in parallel.
  // (Was a separate bg session in an earlier iteration; the runner
  // singleton replaces that mechanism.)
  const handleStartRun = useCallback(async () => {
    if (!projectDirectory || !session.sessionId) return;
    setBgSessionId(session.sessionId);

    // Phase 6.5c.c: route Resume through the pi-agent so the agent
    // is the consistent entry point for bundle runs. Pi-agent's
    // dhee_run_bundle (post-6.5c.c) dispatches via BackgroundTaskRunner,
    // so progress events still surface in the status strip.
    const task = `Continue running the bundle for the current project to completion. Call dhee_run_bundle with projectDir="${projectDirectory}". Stream progress as nodes finish, and once it completes call dhee_show_node_output for the goal node so I can see the result.`;

    setMessages((prev) => [
      ...prev,
      {
        id: newMessageId(),
        role: 'system',
        text: 'Resuming pipeline run…',
      },
    ]);
    streamingMsgIdRef.current = null;
    const result = await session.chatPrompt(task);
    if (!result.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'system',
          text: `Couldn't reach the agent: ${result.error ?? 'unknown error'}.`,
          notificationLevel: 'error',
        },
      ]);
    }
  }, [projectDirectory, session]);

  const handleExport = useCallback(async () => {
    if (!projectDirectory || !session.sessionId) return;
    const exportMessages: PersistedChatMessage[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        type: 'text',
        content: m.text ?? '',
        timestamp: Date.now(),
      }));
    await window.electron.project.exportChatJson({
      exportedAt: new Date().toISOString(),
      projectDirectory,
      sessionId: session.sessionId,
      messages: exportMessages,
    });
  }, [projectDirectory, session.sessionId, messages]);

  const handleSelectOption = useCallback(
    async (questionId: string, option: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === questionId ? { ...m, answered: true } : m)),
      );
      await session.sendResponse(option);
    },
    [session],
  );

  // Main-session readiness gates the textarea / send button. We
  // explicitly DON'T factor bgStatus in here — the user must be able
  // to chat while the long pipeline runs.
  const isReady = session.sessionId !== null && session.status !== 'connecting';
  // The main session's own loop ('running' while it processes a user
  // turn). Used to disable Send during that brief window so we don't
  // pile prompts on top of each other in pi-agent.
  const isMainBusy = session.status === 'running';
  // Header Stop button surfaces when ANY execution lane is busy:
  //   - BackgroundTaskRunner (long pipeline tasks)
  //   - pi-agent chat session looping through tools/edits/etc.
  // handleCancel already aborts both lanes in parallel, so a single
  // Stop affordance covers both. Otherwise a chat that started
  // hammering tool calls (e.g. the agent rabbit-holing on bash/find)
  // had no visible kill switch.
  const isRunning = runnerActive || pendingCancel || isMainBusy;

  const contextPct = contextUsage
    ? Math.round((contextUsage.used / contextUsage.limit) * 100)
    : null;

  const dotStatus =
    session.status === 'error' || connectionError
      ? 'error'
      : isRunning
        ? 'running'
        : isReady
          ? 'ready'
          : 'idle';
  // Header text label needs to match dotStatus, not session.status.
  // Otherwise: pi-agent dispatches a long pipeline via dhee_run_to,
  // pi.session.status flips back to 'idle' once the tool returns
  // (because the runner now drives the work), but the dot is still
  // green from runnerActive — so the badge said "Idle" while the
  // pipeline was clearly running. Surface a unified label.
  const statusText =
    dotStatus === 'error'
      ? 'Error'
      : dotStatus === 'running'
        ? 'Running'
        : dotStatus === 'ready'
          ? 'Ready'
          : session.status === 'connecting'
            ? 'Connecting'
            : 'Idle';

  const sendActive = input.trim().length > 0 && isReady;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div ref={menuWrapperRef} className={styles.projectMenuWrapper}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Project menu"
            className={styles.projectMenuTrigger}
          >
            <span className={styles.projectMenuTriggerLabel}>
              {headerProjectName}
            </span>
            <ChevronDown
              size={14}
              className={`${styles.projectMenuChevron}${menuOpen ? ` ${styles.open}` : ''}`}
            />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="Project actions"
              className={styles.projectMenu}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void handleExport();
                }}
                disabled={!isReady || messages.length === 0}
                className={styles.projectMenuItem}
              >
                <Download size={14} />
                Export chat
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  const ok = window.confirm(
                    'Clear chat history?\n\nStarts a new session. Previous transcript is archived (kept on disk under pi-sessions/.../*.archived.jsonl) and hidden from the chat panel — not destroyed. Project files unaffected.',
                  );
                  if (!ok) return;
                  void session.clearChatHistory().then((res) => {
                    if (res.ok) {
                      // Wipe local UI immediately. Server has already
                      // purged the JSONL and minted a fresh sessionId.
                      setMessages([]);
                      setContextUsage(null);
                    } else {
                      setConnectionError(res.error ?? 'Failed to clear chat');
                    }
                  });
                }}
                disabled={!session.sessionId}
                className={styles.projectMenuItem}
                title="Wipe persisted chat history and start a fresh session"
              >
                New chat
              </button>
            </div>
          )}
        </div>
        <div className={styles.statusRow}>
          <ProjectRunButton
            projectState={projectState}
            running={isRunning}
            ready={isReady}
            pendingCancel={pendingCancel}
            onStart={() => void handleStartRun()}
            onCancel={() => void handleCancel()}
          />
          {/*
            Stop-after-each-collection toggle — the primary run-control
            surface in the header. A prominent labeled switch (not a
            bare icon). Click read-modify-writes
            features.gateAfterCollections in the active project's
            project.json. Disabled while a run is in flight — the flag
            is read once at run start, so it only affects the NEXT run.
            Defaults ON. (Replaced the old agent-oversight / VLM-judge
            eye icons, which moved out of the header.)
          */}
          <button
            type="button"
            role="switch"
            aria-checked={gateAfterCollections}
            disabled={isRunning}
            aria-label="Stop after each collection"
            title={
              isRunning
                ? 'Stop after each collection — pause the run to change this (takes effect next run)'
                : gateAfterCollections
                  ? 'Stop after each collection: ON — the run halts after every collection node (e.g. shot images, clips) so you can review; press Resume to continue'
                  : 'Stop after each collection: OFF — the run goes straight through to the final output'
            }
            onClick={() => void handleToggleGate()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 28,
              padding: '0 12px',
              borderRadius: 14,
              border: '1px solid var(--color-border-subtle)',
              background: gateAfterCollections
                ? 'rgba(var(--color-accent-primary-rgb), 0.18)'
                : 'transparent',
              color: gateAfterCollections
                ? 'var(--color-accent-primary)'
                : 'var(--color-text-secondary)',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              opacity: isRunning ? 0.5 : 1,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              transition: 'background 120ms ease, color 120ms ease, opacity 120ms ease',
            }}
          >
            {/* switch track + sliding knob */}
            <span
              aria-hidden
              style={{
                position: 'relative',
                width: 30,
                height: 16,
                flexShrink: 0,
                borderRadius: 8,
                background: gateAfterCollections
                  ? 'var(--color-accent-primary)'
                  : 'var(--color-text-muted)',
                transition: 'background 120ms ease',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: gateAfterCollections ? 16 : 2,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 120ms ease',
                }}
              />
            </span>
            <span>Stop after each collection</span>
          </button>
          <div
            aria-label={`Status: ${session.status}`}
            title={
              session.error
                ? `Error: ${session.error}`
                : `Status: ${session.status}`
            }
            className={styles.statusIndicator}
          >
            <span className={styles.statusDot} data-status={dotStatus} />
            <span>{statusText}</span>
          </div>
        </div>
      </header>

      {connectionError && (
        <div
          role="alert"
          aria-label="Connection error"
          className={styles.errorBanner}
        >
          <span className={styles.errorBannerText}>
            <AlertCircle size={13} />
            Connection error: {connectionError}
          </span>
          <button
            type="button"
            aria-label="Dismiss connection error"
            onClick={() => setConnectionError(null)}
            className={styles.errorBannerDismiss}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className={styles.messageList}>
        {messages.length === 0 && projectState === null ? (
          // Probe still in flight — neutral placeholder so we don't
          // flash anything before classification completes.
          <div className={styles.emptyPlaceholder}>
            {projectDirectory
              ? 'Loading project…'
              : 'Open a project from the sidebar to begin.'}
          </div>
        ) : (
          groupConsecutiveProgress(messages).map((item) =>
            item.kind === 'progressGroup' ? (
              <ProgressGroup key={item.id} rows={item.rows} />
            ) : item.message.role === 'question' ? (
              <QuestionRow
                key={item.message.id}
                message={item.message}
                onSelect={(opt) => handleSelectOption(item.message.id, opt)}
              />
            ) : item.message.role === 'thinking' ? (
              <ThinkingRow key={item.message.id} message={item.message} />
            ) : (
              <MessageRow
                key={item.message.id}
                message={item.message}
                projectDirectory={projectDirectory}
                onBundleChoiceClick={handleBundleChoiceClick}
                onQuestionCardClick={handleQuestionCardClick}
              />
            ),
          )
        )}
        {/* External question banners — posted via the ChatQuestions
         *  context by non-chat code (e.g. the PreviewPanel's "Redo
         *  from..." flow). Rendered through the same QuestionRow UI
         *  as agent questions so the user sees a uniform prompt
         *  regardless of where it originated. */}
        {chatQuestions.pending.map((q) => (
          <QuestionRow
            key={q.id}
            message={{
              id: q.id,
              role: 'question',
              question: q.question,
              options: q.options,
              defaultOption: q.defaultOption,
              answered: false,
            }}
            onSelect={(opt) => chatQuestions.resolveQuestion(q.id, opt)}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <footer className={styles.footer}>
        {/*
          Contextual CTA renders here — directly above the input —
          when the chat is empty and the project's lifecycle is
          either in_progress or completed. Position rationale: action
          prompts belong next to the action surface (the typing
          area). Matches modern chat patterns (suggested-prompts
          rails sit above the composer in ChatGPT, Cursor, etc.).
          'fresh' projects route to the full wizard panel above the
          messages region, not here.
        */}
        {messages.length === 0 &&
          (projectState === 'in_progress' || projectState === 'completed') && (
            <ProjectCTA
              state={projectState}
              projectName={headerProjectName}
              projectDir={projectDirectory ?? ''}
              onAction={(a) => void handleCTAAction(a)}
            />
          )}
        {chatAttachments.length > 0 && (
          <div className={styles.attachmentRow}>
            {chatAttachments.map((att) => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onRemove={handleRemoveAttachment}
                disabled={isMainBusy}
              />
            ))}
          </div>
        )}
        {attachmentError && (
          <div className={styles.attachmentError}>{attachmentError}</div>
        )}
        <div className={styles.inputWrapper}>
          <button
            type="button"
            onClick={handleAttachClick}
            aria-label="Attach file"
            title="Attach a ComfyUI workflow JSON"
            disabled={!isReady || isMainBusy}
            className={styles.attachButton}
          >
            <Paperclip size={16} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value.trim()) {
                firstRunTour.notifyTourEvent('chat_prompt_valid');
              }
            }}
            placeholder={
              isMainBusy
                ? 'Thinking…'
                : isRunning
                  ? `Type to ask while the pipeline runs (e.g. "show me shot 1")…`
                  : 'Type a task and press Enter…'
            }
            rows={2}
            disabled={!isReady}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim().length > 0 || chatAttachments.length > 0)
                  handleSend();
              }
            }}
            className={styles.textarea}
            data-tour-id="workspace-chat-input"
          />
          <button
            type="button"
            onClick={handleSend}
            aria-label="Send"
            title={
              isMainBusy
                ? 'Cancel the current reply and send this message'
                : 'Send (Enter)'
            }
            disabled={
              !isReady ||
              (input.trim().length === 0 && chatAttachments.length === 0)
            }
            className={`${styles.sendButton}${sendActive ? ` ${styles.active}` : ''}`}
          >
            {isMainBusy ? (
              <Loader2 size={14} className={styles.spinning} />
            ) : (
              <ArrowUp size={18} strokeWidth={2.5} />
            )}
          </button>
        </div>
        {contextPct !== null && (
          <div
            aria-label="Context usage"
            className={`${styles.contextUsage}${contextPct >= 80 ? ` ${styles.warning}` : ''}`}
          >
            {contextUsage!.used.toLocaleString()} /{' '}
            {contextUsage!.limit.toLocaleString()} tokens · {contextPct}%
          </div>
        )}
      </footer>
    </div>
  );
}

function QuestionRow({
  message: m,
  onSelect,
}: {
  message: ChatMessage;
  onSelect: (option: string) => void;
}) {
  return (
    <div className={styles.questionRow}>
      <div className={styles.questionText}>{m.question}</div>
      {m.options && m.options.length > 0 && (
        <div className={styles.questionOptions}>
          {m.options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={m.answered}
              onClick={() => onSelect(opt)}
              className={styles.questionOption}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Reasoning trace from a "thinking" model (DeepSeek-R, o-series,
 * Gemini-thinking, Claude with extended thinking, …). Collapsed by
 * default — these can be long and noisy, but seeing them is critical
 * for trust ("what is the model actually doing during that 30s
 * pause?") and for debugging stub-plan / truncation issues. Click to
 * expand the full body.
 */
function ThinkingRow({ message: m }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const body = (m.thinkingText ?? '').trim();
  const preview = body.length > 120 ? `${body.slice(0, 120)}…` : body;
  if (!body) return null;
  return (
    <div className={styles.thinkingRow}>
      <button
        type="button"
        className={styles.thinkingToggle}
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
      >
        <span className={styles.thinkingGlyph} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className={styles.thinkingLabel}>thinking</span>
        {!expanded && <span className={styles.thinkingPreview}>{preview}</span>}
      </button>
      {expanded && <pre className={styles.thinkingBody}>{body}</pre>}
    </div>
  );
}

function ProgressGroup({ rows }: { rows: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(-1);

  return (
    <div aria-label="Run progress group">
      <button
        type="button"
        aria-label={expanded ? 'Collapse run progress' : 'Expand run progress'}
        onClick={() => setExpanded((current) => !current)}
        className={styles.progressRow}
      >
        {expanded ? 'Hide run progress' : `Show run progress (${rows.length})`}
      </button>
      {visibleRows.map((row) => (
        <div
          key={row.id}
          aria-label="Run progress"
          className={styles.progressRow}
        >
          {row.progressText}
        </div>
      ))}
    </div>
  );
}

function MessageRow({
  message: m,
  projectDirectory,
  onBundleChoiceClick,
  onQuestionCardClick,
}: {
  message: ChatMessage;
  projectDirectory: string | null;
  onBundleChoiceClick?: (msgId: string, bundleId: string) => void;
  onQuestionCardClick?: (msgId: string, optionId: string, kind: 'toggle' | 'submit' | 'pick') => void;
}) {
  if (m.role === 'bundle-choices' && m.bundleChoices) {
    const made = m.bundleChoiceMade ?? null;
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          margin: '4px 0',
        }}
      >
        {m.bundleChoices.question && (
          <div style={{ fontSize: 12, color: 'rgba(229, 225, 216, 0.75)' }}>
            {m.bundleChoices.question}
          </div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 8,
          }}
        >
          {m.bundleChoices.ids.map((bid) => {
            const isMade = made === bid;
            const otherMade = made !== null && made !== bid;
            // Prefer the rich metadata from the agent's tool payload;
            // fall back to the bare id when the legacy shape lands.
            const meta = m.bundleChoices?.bundles?.find((b) => b.id === bid);
            const displayName = meta?.displayName ?? bid;
            const summary = meta?.summary ?? '';
            return (
              <button
                key={bid}
                disabled={made !== null}
                onClick={() => onBundleChoiceClick?.(m.id, bid)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: `1px solid ${isMade ? '#5f88b2' : 'rgba(168, 156, 139, 0.24)'}`,
                  background: isMade ? '#1c2533' : '#161821',
                  color: otherMade ? 'rgba(229, 225, 216, 0.4)' : '#e5e1d8',
                  cursor: made !== null ? 'default' : 'pointer',
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: summary ? 4 : 0 }}>
                  {displayName}
                </div>
                {summary && (
                  <div
                    style={{
                      fontSize: 12,
                      color: otherMade ? 'rgba(229, 225, 216, 0.35)' : 'rgba(229, 225, 216, 0.7)',
                      lineHeight: 1.45,
                    }}
                  >
                    {summary}
                  </div>
                )}
                {isMade && (
                  <div style={{ fontSize: 11, color: '#5f88b2', marginTop: 6 }}>✓ selected</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (m.role === 'question-card' && m.questionCard) {
    const picked = m.questionCardAnswered ?? [];
    const submitted = !m.questionCard.multiSelect && picked.length > 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0' }}>
        <div style={{ fontSize: 13, color: 'rgba(229, 225, 216, 0.85)', fontWeight: 500 }}>
          {m.questionCard.question}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 8,
          }}
        >
          {m.questionCard.options.map((opt) => {
            const isPicked = picked.includes(opt.id);
            const otherSubmitted = submitted && !isPicked;
            const clickKind: 'pick' | 'toggle' = m.questionCard!.multiSelect ? 'toggle' : 'pick';
            return (
              <button
                key={opt.id}
                disabled={submitted}
                onClick={() => onQuestionCardClick?.(m.id, opt.id, clickKind)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: `1px solid ${isPicked ? '#5f88b2' : 'rgba(168, 156, 139, 0.24)'}`,
                  background: isPicked ? '#1c2533' : '#161821',
                  color: otherSubmitted ? 'rgba(229, 225, 216, 0.4)' : '#e5e1d8',
                  cursor: submitted ? 'default' : 'pointer',
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: opt.description ? 4 : 0 }}>
                  {opt.label}
                </div>
                {opt.description && (
                  <div
                    style={{
                      fontSize: 12,
                      color: otherSubmitted ? 'rgba(229, 225, 216, 0.35)' : 'rgba(229, 225, 216, 0.7)',
                      lineHeight: 1.45,
                    }}
                  >
                    {opt.description}
                  </div>
                )}
                {isPicked && (
                  <div style={{ fontSize: 11, color: '#5f88b2', marginTop: 6 }}>✓ selected</div>
                )}
              </button>
            );
          })}
        </div>
        {m.questionCard.multiSelect && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              onClick={() => onQuestionCardClick?.(m.id, '', 'submit')}
              disabled={picked.length === 0}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid rgba(168, 156, 139, 0.4)',
                background: picked.length > 0 ? '#1c2533' : 'transparent',
                color: picked.length > 0 ? '#e5e1d8' : 'rgba(229, 225, 216, 0.4)',
                cursor: picked.length > 0 ? 'pointer' : 'default',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Done ({picked.length})
            </button>
          </div>
        )}
      </div>
    );
  }
  if (m.role === 'tool') {
    // Production-board tag: status dot (pulses while running) +
    // monospace tool name + optional duration chip. Args render on
    // a second line, indented under the name so the head row stays
    // scannable. Per-line progress for long-running tools (e.g.
    // dhee_run_to) streams in as separate `progress` rows just below
    // this card.
    const status = m.toolStatus ?? 'in_progress';
    return (
      <div className={styles.toolCard} data-status={status}>
        <div className={styles.toolHead}>
          <span className={styles.toolDot} data-status={status} aria-hidden="true" />
          <span className={styles.toolName}>{m.toolName}</span>
        </div>
        {m.toolArgsSummary && (
          <div className={styles.toolArgs}>{m.toolArgsSummary}</div>
        )}
      </div>
    );
  }
  if (m.role === 'progress') {
    // One row per chunk from a long-running tool. Indented + faint
    // accent so the user can scan the run's heartbeat at a glance,
    // while still getting one discrete "block" per progress event
    // (instead of one big concatenated <pre>).
    return (
      <div aria-label="Run progress" className={styles.progressRow}>
        {m.progressText}
      </div>
    );
  }
  if (m.role === 'system') {
    // Compact "the user just took an action" pill — used for things
    // like "Resuming pipeline run…" or CTA labels. Distinct enough
    // from chat bubbles that the eye reads it as metadata, not as
    // either party speaking.
    //
    // When the system row was synthesized from an executor 'error' or
    // 'warning' notification, style it as a distinct error/warning
    // card so ComfyUI/LLM failures don't read as ordinary metadata.
    const levelClass =
      m.notificationLevel === 'error'
        ? ` ${styles.systemPillError ?? ''}`
        : m.notificationLevel === 'warning'
          ? ` ${styles.systemPillWarning ?? ''}`
          : '';
    return (
      <div className={`${styles.systemPill}${levelClass}`.trim()}>{m.text}</div>
    );
  }
  if (m.role === 'phase') {
    return (
      <div aria-label="Phase transition" className={styles.phaseRow}>
        {m.text}
      </div>
    );
  }
  if (m.role === 'media') {
    const rawSrc = m.mediaPath
      ? resolveMediaSrc(m.mediaPath, projectDirectory)
      : '';
    const resolvedSrc = cacheBustMediaSrc(rawSrc, m.mediaCreatedAt ?? null);
    // Strip the project directory + leading slash so the caption
    // shows just the artifact-relative path (e.g.
    // "assets/shot_5/first_frame.png") instead of the absolute
    // mount path. Falls back to the full path when stripping
    // doesn't apply.
    const captionPath = (() => {
      const p = m.mediaPath ?? '';
      if (!p) return '';
      if (projectDirectory && p.startsWith(projectDirectory)) {
        return p.slice(projectDirectory.length).replace(/^\/+/, '');
      }
      const lastSlash = p.lastIndexOf('/');
      return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
    })();
    return (
      <div className={styles.mediaRow}>
        <div className={styles.mediaFrame}>
          {m.mediaKind === 'image' && resolvedSrc ? (
            <img
              src={resolvedSrc}
              alt={`${m.mediaProject ?? ''} ${m.mediaPath}`}
              className={styles.mediaImage}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : m.mediaKind === 'video' && resolvedSrc ? (
            <video
              src={resolvedSrc}
              controls
              preload="metadata"
              className={styles.mediaImage}
            />
          ) : (
            <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>
              {m.mediaPath}
            </div>
          )}
        </div>
        <div className={styles.mediaCaption}>
          <span className={styles.mediaKindBadge}>{m.mediaKind}</span>
          <span className={styles.mediaCaptionPath}>{captionPath}</span>
        </div>
      </div>
    );
  }
  // user / assistant — editorial eyebrow + body.
  if (m.role === 'user') {
    return (
      <div className={`${styles.bubble} ${styles.bubbleUser}`}>
        <span className={styles.bubbleEyebrow}>You</span>
        <div className={styles.bubbleBody}>{m.text}</div>
      </div>
    );
  }
  // Render-layer guard: skip empty/whitespace-only assistant bubbles.
  // Multiple upstream paths can land an empty assistant message (a
  // trailing empty stream_chunk after agent_response cleared the ref,
  // a duplicate agent_response with no output, the chatPrompt fallback
  // when assistant_text comes back blank). Showing a bubble with just
  // the "Dhee" eyebrow and no body is the visible bug. Catching it
  // here covers every producer.
  const assistantText = dedupeDoubled(m.text ?? '');
  if (!assistantText.trim()) {
    return null;
  }
  return (
    <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
      <span className={styles.bubbleEyebrow}>Dhee</span>
      <div className={styles.bubbleBody}>
        {/* Render-layer dedup as a safety net: the upstream LLM
            stream sometimes accumulates the same text twice
            (stream_chunk arriving with full content twice). Catching
            it here covers every code path that builds the bubble. */}
        <MarkdownContent text={assistantText} />
      </div>
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  // remark-gfm gives us tables, strikethrough, autolinks, task lists.
  // Heading/paragraph overrides tighten spacing for chat density —
  // only structural layout, no hardcoded colors.
  const components = useMemo(
    () => ({
      h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h1 style={{ fontSize: 18, margin: '6px 0' }} {...props} />
      ),
      h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h2 style={{ fontSize: 16, margin: '6px 0' }} {...props} />
      ),
      h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h3 style={{ fontSize: 15, margin: '4px 0' }} {...props} />
      ),
      p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
        <p style={{ margin: '4px 0' }} {...props} />
      ),
      ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
        <ul style={{ margin: '4px 0', paddingLeft: 18 }} {...props} />
      ),
      ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
        <ol style={{ margin: '4px 0', paddingLeft: 18 }} {...props} />
      ),
      // code/pre/a styling lives in .bubbleAssistant :global() in the SCSS module
    }),
    [],
  );
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}

/**
 * Tools whose successful completion can change the project's lifecycle
 * classification (fresh / in_progress / completed). When any of these
 * finishes the chat panel bumps `probeNonce` so the cached
 * `projectState` re-syncs from disk — closing the race where the
 * initial probe ran before dhee_new had written style/templateId/
 * duration into project.json, leaving the run/resume button hidden.
 */
const LIFECYCLE_MUTATING_TOOLS = new Set([
  'dhee_new',
  'dhee_setup_project',
  'dhee_run_to',
  'dhee_reset',
]);

function handleEvent(
  event: dheeEvent,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  streamingMsgIdRef: React.RefObject<string | null>,
  setContextUsage: React.Dispatch<React.SetStateAction<ContextUsage | null>>,
  toolNameByCallIdRef: React.RefObject<Map<string, string>>,
  setProbeNonce: React.Dispatch<React.SetStateAction<number>>,
): void {
  switch (event.eventName) {
    case 'tool_call': {
      const data = event.data as {
        toolCallId?: string;
        toolName?: string;
        arguments?: unknown;
        status?: ToolStatus;
      };
      // Finalize any in-flight streaming bubble — once a tool call
      // fires the agent isn't actively typing user-facing text.
      // Also mark the bubble streaming:false so it doesn't stay in
      // a spinning state; agent_response will update it with the
      // canonical final text when it arrives.
      const prevStreamId = streamingMsgIdRef.current;
      streamingMsgIdRef.current = null;
      // Record the toolName so subsequent stream_chunk events can
      // filter by it.
      if (data.toolCallId && data.toolName) {
        toolNameByCallIdRef.current?.set(data.toolCallId, data.toolName);
      }
      setMessages((prev) => {
        const withFinalized = prevStreamId
          ? prev.map((m) =>
              m.id === prevStreamId ? { ...m, streaming: false } : m,
            )
          : prev;
        return [
          ...withFinalized,
          {
            id: newMessageId(),
            role: 'tool',
            toolCallId: data.toolCallId,
            toolName: data.toolName ?? '(unknown tool)',
            toolStatus: data.status ?? 'in_progress',
            toolArgsSummary: summarizeArgs(data.arguments),
          },
        ];
      });
      return;
    }
    case 'tool_result': {
      const data = event.data as {
        toolCallId?: string;
        isError?: boolean;
        result?: {
          file_path?: string;
          asset_type?: string;
          // The main process flattens the pi tool result's content
          // ([{type:'text',text}]) to a plain string before forwarding
          // (dheeCoreManager tool_execution_end mapping). Accept BOTH.
          content?: string | Array<{ type?: string; text?: string }>;
          details?: { file_path?: string; asset_type?: string; created_at?: number };
        };
      };
      // Update the matching tool card in place (NOT a new card).
      const newStatus: ToolStatus = data.isError ? 'error' : 'completed';
      const toolNameForChoices = data.toolCallId
        ? toolNameByCallIdRef.current?.get(data.toolCallId)
        : undefined;
      let bundleChoices: {
        ids: string[];
        bundles?: Array<{ id: string; displayName: string; summary: string }>;
        question?: string;
      } | null = null;
      if (
        !data.isError
        && toolNameForChoices === 'dhee_present_bundle_choices'
      ) {
        try {
          const txt = toolResultText(data.result?.content);
          const parsed = JSON.parse(txt) as {
            kind?: string;
            bundleIds?: string[];
            bundles?: Array<{ id?: string; displayName?: string; summary?: string }>;
            question?: string;
          };
          if (parsed.kind === 'bundle_choices' && Array.isArray(parsed.bundleIds) && parsed.bundleIds.length > 0) {
            // Normalize the rich `bundles` array — every entry needs
            // an id; missing displayName/summary fall through to
            // empty (the renderer can titleize the id as a last
            // resort).
            const normalizedBundles = Array.isArray(parsed.bundles)
              ? parsed.bundles
                  .filter((b): b is { id: string; displayName?: string; summary?: string } =>
                    !!b && typeof b.id === 'string' && b.id.length > 0,
                  )
                  .map((b) => ({
                    id: b.id,
                    displayName: typeof b.displayName === 'string' && b.displayName.trim().length > 0
                      ? b.displayName.trim()
                      : b.id,
                    summary: typeof b.summary === 'string' ? b.summary.trim() : '',
                  }))
              : undefined;
            bundleChoices = {
              ids: parsed.bundleIds,
              ...(normalizedBundles ? { bundles: normalizedBundles } : {}),
              ...(parsed.question ? { question: parsed.question } : {}),
            };
          }
        } catch {
          // Not a JSON payload we recognize — skip the rich render.
        }
      }
      // Generic ask-question picker — payload shape:
      //   { kind: 'question_choices', question, options: [...], multiSelect }
      let questionCard: {
        question: string;
        options: Array<{ id: string; label: string; description?: string }>;
        multiSelect: boolean;
      } | null = null;
      if (
        !data.isError
        && toolNameForChoices === 'dhee_ask_question'
      ) {
        try {
          const txt = toolResultText(data.result?.content);
          const parsed = JSON.parse(txt) as {
            kind?: string;
            question?: string;
            options?: Array<{ id?: string; label?: string; description?: string }>;
            multiSelect?: boolean;
          };
          if (
            parsed.kind === 'question_choices'
            && typeof parsed.question === 'string'
            && Array.isArray(parsed.options)
            && parsed.options.length > 0
          ) {
            const normalizedOpts = parsed.options
              .filter((o): o is { id: string; label?: string; description?: string } =>
                !!o && typeof o.id === 'string' && o.id.length > 0)
              .map((o) => ({
                id: o.id,
                label: typeof o.label === 'string' && o.label.length > 0 ? o.label : o.id,
                ...(typeof o.description === 'string' && o.description.length > 0
                  ? { description: o.description }
                  : {}),
              }));
            if (normalizedOpts.length > 0) {
              questionCard = {
                question: parsed.question,
                options: normalizedOpts,
                multiSelect: parsed.multiSelect === true,
              };
            }
          }
        } catch {
          // payload not recognized — fall through to default rendering
        }
      }

      setMessages((prev) => {
        const updated: ChatMessage[] = prev.map((m) =>
          m.role === 'tool' && m.toolCallId === data.toolCallId
            ? { ...m, toolStatus: newStatus }
            : m,
        );
        // Bundle picker — append a clickable cards row.
        if (bundleChoices) {
          return [
            ...updated,
            {
              id: newMessageId(),
              role: 'bundle-choices' as const,
              bundleChoices,
              bundleChoiceMade: null,
            },
          ];
        }
        // Generic question card.
        if (questionCard) {
          return [
            ...updated,
            {
              id: newMessageId(),
              role: 'question-card' as const,
              questionCard,
              questionCardAnswered: null,
            },
          ];
        }
        // Phase 6.5c.b: when a tool result has a file_path (dhee_show_*
        // tools), append a `media` row so the chat renders the image/
        // video inline. Path lives under result.details.file_path for
        // dhee custom tools; extractToolResultFilePath handles both
        // shapes (and the legacy flat one) so the lookup doesn't miss.
        const { filePath, createdAt } = extractToolResultFilePath(data.result);
        if (!data.isError && filePath) {
          const ext = filePath.toLowerCase().match(/\.(\w+)$/)?.[1] ?? '';
          const isImage = /^(png|jpg|jpeg|gif|webp|bmp)$/i.test(ext);
          const isVideo = /^(mp4|mov|webm|mkv|m4v)$/i.test(ext);
          if (isImage || isVideo) {
            return [
              ...updated,
              {
                id: newMessageId(),
                role: 'media' as const,
                mediaKind: (isImage ? 'image' : 'video') as 'image' | 'video',
                // Stamp the createdAt on the mediaPath as a cache-bust
                // key so the renderer fetches fresh bytes when the
                // canonical artifact has been overwritten since the
                // last render of this file:// URL.
                mediaPath: filePath,
                ...(createdAt ? { mediaCreatedAt: createdAt } : {}),
              } as ChatMessage,
            ];
          }
        }
        return updated;
      });
      // If this tool may have mutated project.json's lifecycle fields,
      // ask the chat panel to re-probe. Lookup MUST happen BEFORE the
      // delete below — once the entry is dropped from the map the tool
      // name is gone.
      if (data.toolCallId && !data.isError) {
        const toolName = toolNameByCallIdRef.current?.get(data.toolCallId);
        if (toolName && LIFECYCLE_MUTATING_TOOLS.has(toolName)) {
          setProbeNonce((n) => n + 1);
        }
      }
      // Tool is done — drop the toolName entry to keep the map small.
      if (data.toolCallId) {
        toolNameByCallIdRef.current?.delete(data.toolCallId);
      }
      return;
    }
    case 'stream_chunk': {
      const data = event.data as {
        content?: string;
        done?: boolean;
        toolCallId?: string;
      };
      // tool_streaming events also use this channel — they include a
      // toolCallId. Each chunk gets its OWN row so the long
      // dhee_run_to log doesn't become one unreadable concatenated
      // blob. The originating tool card stays compact at the top of
      // the run; the per-line rows stream in below it (and naturally
      // interleave with any user chat that comes in mid-run).
      if (data.toolCallId) {
        // Reasoning-model chain-of-thought arrives as tool_streaming
        // chunks wrapped in `<thinking>…</thinking>` (LLMClient splits
        // out the model's `reasoning_content` or any inline `<think>`
        // block; ExecutorAgent re-emits it as tool_streaming with
        // those tags). Route to a dedicated thinking row BEFORE the
        // kshana_* filter so non-kshana tools (e.g. the executor's
        // own `generate_scene_shot_plan` Stage A call) still surface
        // their reasoning. Without this, the thinking text was either
        // dropped or buried inside the tool card's collapsed body
        // and the user never saw what the model was "thinking".
        const rawChunk = data.content ?? '';
        const thinkingText = extractThinkingText(rawChunk);
        if (thinkingText.length > 0) {
          setMessages((prev) => {
            // Coalesce with the most recent thinking row for THIS
            // tool call so a long reasoning trace shows as one
            // growing block, not 50 tiny rows.
            const last = prev[prev.length - 1];
            if (
              last?.role === 'thinking' &&
              last.thinkingForToolCallId === data.toolCallId
            ) {
              return prev.map((m, i) =>
                i === prev.length - 1
                  ? {
                      ...m,
                      thinkingText: (m.thinkingText ?? '') + thinkingText,
                    }
                  : m,
              );
            }
            return [
              ...prev,
              {
                id: newMessageId(),
                role: 'thinking' as const,
                thinkingForToolCallId: data.toolCallId,
                thinkingText,
              },
            ];
          });
          // If the chunk was PURE thinking, nothing else to surface.
          // If it had non-thinking text too (rare — the executor wraps
          // <thinking> separately from regular content), fall through
          // so the remainder still hits the progress-row path below.
          const remainder = stripThinkingTags(rawChunk);
          if (remainder.trim().length === 0) return;
          // Substitute the cleaned chunk for downstream processing.
          (data as { content?: string }).content = remainder;
        }
        // Filter: only kshana_* tools (dhee_run_to, kshana_render_*)
        // surface their per-line progress in the chat. Internal
        // pi-agent tool output (bash listings, file reads, grep
        // results, …) gets dropped — without this filter the chat
        // gets flooded with `ls -la` outputs and file dumps.
        const parentToolName = toolNameByCallIdRef.current?.get(
          data.toolCallId,
        );
        if (!parentToolName || !parentToolName.startsWith('dhee_')) {
          return;
        }
        const chunk = data.content ?? '';
        // Pi-agent's stream_chunk events sometimes split a logical
        // line across multiple chunks (e.g. when the executor's
        // output emits "  [tool] " then "  → completed" within ms).
        // Coalesce within a 250ms window per toolCallId so we don't
        // explode one conceptual log line into two rows. Lines
        // separated by the executor's own newline boundaries always
        // create a fresh row.
        const trimmed = chunk.trim();
        if (!trimmed) return;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const NOW = Date.now();
          const lastTs = (last as (ChatMessage & { _ts?: number }) | undefined)
            ?._ts;
          const canCoalesce =
            last?.role === 'progress' &&
            last.progressForToolCallId === data.toolCallId &&
            !chunk.includes('\n') &&
            !(last.progressText ?? '').includes('\n') &&
            typeof lastTs === 'number' &&
            NOW - lastTs < 250;
          if (canCoalesce) {
            return prev.map((m, i) =>
              i === prev.length - 1
                ? {
                    ...m,
                    progressText: ((m.progressText ?? '') + chunk).trim(),
                    // refresh the timestamp so subsequent very-close
                    // chunks keep coalescing
                    ...({ _ts: NOW } as Record<string, unknown>),
                  }
                : m,
            );
          }
          // Each chunk that looks like multiple lines: split, push
          // one row per non-empty line.
          const lines = chunk
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          const newRows: ChatMessage[] = lines.map((line) => ({
            id: newMessageId(),
            role: 'progress' as const,
            progressForToolCallId: data.toolCallId,
            progressText: line,
            ...({ _ts: NOW } as Record<string, unknown>),
          }));
          return [...prev, ...newRows];
        });
        return;
      }
      const chunk = data.content ?? '';
      setMessages((prev) => {
        const id = streamingMsgIdRef.current;
        if (id) {
          return prev.map((m) =>
            m.id === id
              ? { ...m, text: mergeStreamText(m.text, chunk, data.done) }
              : m,
          );
        }
        const newId = newMessageId();
        streamingMsgIdRef.current = newId;
        return [
          ...prev,
          { id: newId, role: 'assistant', text: chunk, streaming: true },
        ];
      });
      // Note: do NOT clear streamingMsgIdRef on done=true. The agent
      // emits a final `agent_response` carrying the canonical full
      // text; if we cleared the ref here, that response would create
      // a SECOND bubble with the same text (the duplicate the user
      // saw). Keep the ref alive so agent_response updates the same
      // bubble in place. The ref is cleared on tool_call (next turn)
      // and on user send (next conversation round).
      return;
    }
    case 'agent_response': {
      const data = event.data as { output?: string; status?: string };
      if (!data.output) return;
      // Defense against an upstream bug where the LLM stream
      // sometimes emits the same response twice concatenated
      // (saw "Full Story generated.Full Story generated." in
      // the wild). dedupeDoubled collapses a perfectly-doubled
      // string back to one copy.
      const finalOutput = dedupeDoubled(data.output);
      // If we have a streaming bubble in flight, replace its text
      // with the canonical final string. Otherwise update the last
      // assistant bubble when this is the same final response arriving
      // through a second event path.
      const id = streamingMsgIdRef.current;
      if (id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, text: finalOutput, streaming: false } : m,
          ),
        );
        streamingMsgIdRef.current = null;
      } else {
        // streamingMsgIdRef was cleared mid-stream by a tool_call event.
        // The OLD code searched for a bubble with `streaming: true` —
        // but tool_call explicitly flips prior bubbles to streaming:false,
        // so by the time agent_response lands after several tool calls,
        // no bubble has streaming:true and the renderer appended a brand-
        // new bubble carrying the entire turn's text. The user already
        // saw that text as intermediate "Let me check X" bubbles, so the
        // new bubble looked like a full duplicate dump on stop.
        //
        // Fix: find the most-recent ASSISTANT bubble in the current
        // turn (regardless of streaming flag) and update it with the
        // canonical text. Only append a fresh bubble when no assistant
        // bubble exists in the current turn at all.
        setMessages((prev) => {
          const idx = findCanonicalAssistantBubbleIdx(prev);
          if (idx !== -1) {
            return prev.map((m, i) =>
              i === idx ? { ...m, text: finalOutput, streaming: false } : m,
            );
          }
          return [
            ...prev,
            { id: newMessageId(), role: 'assistant', text: finalOutput },
          ];
        });
      }
      return;
    }
    case 'media_generated': {
      const data = event.data as {
        kind?: 'image' | 'video';
        path?: string;
        project?: string;
      };
      streamingMsgIdRef.current = null;
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'media',
          mediaKind: data.kind ?? 'image',
          mediaPath: data.path,
          mediaProject: data.project,
        },
      ]);
      return;
    }
    case 'notification': {
      const data = event.data as { level?: string; message?: string };
      if (!data.message) return;
      const rawLevel = data.level ?? 'info';
      const level: 'info' | 'warning' | 'error' =
        rawLevel === 'error' || rawLevel === 'warning' ? rawLevel : 'info';
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'system',
          text: level === 'info' ? data.message! : `[${level}] ${data.message}`,
          notificationLevel: level,
        },
      ]);
      return;
    }
    case 'agent_question': {
      const data = event.data as {
        question?: string;
        options?: string[];
        defaultOption?: string;
      };
      if (!data.question) return;
      streamingMsgIdRef.current = null;
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'question',
          question: data.question,
          options: data.options ?? [],
          defaultOption: data.defaultOption,
          answered: false,
        },
      ]);
      return;
    }
    case 'phase_transition': {
      const data = event.data as { phase?: string; status?: string };
      if (!data.phase) return;
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'phase',
          text: `${data.phase}${data.status ? ` · ${data.status}` : ''}`,
        },
      ]);
      return;
    }
    case 'context_usage': {
      const data = event.data as { used?: number; limit?: number };
      if (typeof data.used !== 'number' || typeof data.limit !== 'number')
        return;
      setContextUsage({ used: data.used, limit: data.limit });
      return;
    }
    default:
      return;
  }
}
