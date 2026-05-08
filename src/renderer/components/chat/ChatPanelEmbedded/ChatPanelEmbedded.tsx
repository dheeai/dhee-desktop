/**
 * ChatPanelEmbedded — chat UI built directly on the typed
 * `window.kshana.*` IPC surface (via `useKshanaSession`).
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
  Eye,
  EyeOff,
  Loader2,
  Paperclip,
  ScanEye,
  X,
} from 'lucide-react';
import type { Attachment } from '../../../../shared/attachmentTypes';
import AttachmentChip from '../ChatInput/AttachmentChip';
import styles from './ChatPanelEmbedded.module.scss';
import { useKshanaSession } from '../../../hooks/useKshanaSession';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useAppSettings } from '../../../contexts/AppSettingsContext';
import { useAgent } from '../../../contexts/AgentContext';
import type { KshanaEvent } from '../../../../shared/kshanaIpc';
import type { PersistedChatMessage } from '../../../../shared/chatTypes';
import ProjectSetupPanel, {
  type SetupPanelMode,
  type SetupStep,
} from '../ProjectSetupPanel';
import { buildWizardKickoff } from './buildWizardKickoff';
import { shouldAutoOpenWizard } from './setupAutoOpen';
import {
  WIZARD_TEMPLATES,
  WIZARD_DURATION_PRESETS,
  WIZARD_DEFAULT_TEMPLATE_ID,
  WIZARD_DEFAULT_STYLE_ID,
  WIZARD_DEFAULT_DURATION_SECONDS,
} from './wizardCatalog';
import { loadPersistedProjectSetup } from './loadPersistedProjectSetup';
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
  | 'progress';
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
   * (e.g. kshana_run_to). One row per stream_chunk event so each
   * `[info] [N/M] Working on…` line is its own discrete block in the
   * chat — easier to scan than the previous "all concatenated into
   * one giant <pre> blob" rendering.
   */
  progressForToolCallId?: string;
  /** For role='progress' rows: the line itself (already trimmed). */
  progressText?: string;
  mediaKind?: 'image' | 'video';
  mediaPath?: string;
  mediaProject?: string;
  /** Streaming bubbles aren't yet finalized; agent_response replaces text. */
  streaming?: boolean;
  /** agent_question fields */
  question?: string;
  options?: string[];
  defaultOption?: string;
  answered?: boolean;
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
 * How often to poll `window.kshana.runnerStatus()` for the active
 * task. The runner is the single source of truth for whether a long
 * pipeline is in flight; this poll interval bounds how quickly the
 * header Stop button appears/disappears in response to runner state
 * changes. 1500ms is a reasonable trade-off — fast enough that the
 * user perceives Stop appearing "right after" they hit Resume, slow
 * enough that we don't flood the IPC layer.
 */
const RUNNER_STATUS_POLL_MS = 1500;

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
function dedupeDoubled(text: string): string {
  const len = text.length;
  if (len < 120 || len % 2 !== 0) return text;
  const half = len / 2;
  if (text.slice(0, half) === text.slice(half)) {
    return text.slice(0, half);
  }
  return text;
}

function mergeStreamText(prev: string | undefined, chunk: string, done?: boolean): string {
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

function resolveMediaSrc(mediaPath: string, projectDirectory: string | null): string {
  const trimmed = mediaPath.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;

  const absolutePath =
    trimmed.startsWith('/') || !projectDirectory
      ? trimmed
      : `${projectDirectory.replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`;

  return `file://${absolutePath}`;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  // Pick the most useful 1-2 args, truncate long values.
  const parts = entries.slice(0, 2).map(([k, v]) => {
    let value = '';
    if (typeof v === 'string') value = v;
    else if (typeof v === 'number' || typeof v === 'boolean') value = String(v);
    else value = JSON.stringify(v);
    if (value.length > 32) value = `${value.slice(0, 32)}…`;
    return `${k}=${value}`;
  });
  return parts.join(' ');
}

export default function ChatPanelEmbedded() {
  const session = useKshanaSession();
  const { projectName, projectDirectory } = useWorkspace();
  const agent = useAgent();
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

  // ── Resume hydration ──────────────────────────────────────────────
  // When the session was reconstructed from disk on app launch, the
  // hook hands us a HistorySnapshot. Translate it into local
  // ChatMessage rows so the panel renders the prior conversation as if
  // it had been streamed live. One-shot: consumeHistory() reads-and-
  // clears, so a later remount won't double-seed.
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
    setMessages(rows.map(r => r.msg));
  }, [session.sessionId, session.history, session.consumeHistory]);

  // ── New-project wizard state ──────────────────────────────────────
  // Auto-spawns when the user opens an unconfigured project. Collects
  // style → duration → story; on confirm, calls session.configureProject
  // (persists template/style/duration into project.json) then runs a
  // kickoff task that pi-agent routes to `kshana_new` with `existingDir`.
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

  const [setupPanelMode, setSetupPanelMode] = useState<SetupPanelMode>('hidden');
  const [setupStep, setSetupStep] = useState<SetupStep>('style');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    WIZARD_DEFAULT_TEMPLATE_ID,
  );
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(
    WIZARD_DEFAULT_STYLE_ID,
  );
  const [selectedDuration, setSelectedDuration] = useState<number | null>(
    WIZARD_DEFAULT_DURATION_SECONDS,
  );
  const [storyInput, setStoryInput] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isConfiguringSetup, setIsConfiguringSetup] = useState(false);
  const [isSetupConfigured, setIsSetupConfigured] = useState(false);
  // Whether we've already finished the "is this project fresh?"
  // probe. Until this flips true the auto-open effect mustn't fire,
  // otherwise it'd flash open and then snap shut on a configured
  // project.
  const [setupProbeCompleted, setSetupProbeCompleted] = useState(false);
  // Classified lifecycle state for the active project. Drives whether
  // we render a contextual CTA (in_progress / completed) in the empty
  // chat area; 'fresh' projects route to the wizard via setupPanelMode.
  const [projectState, setProjectState] = useState<ProjectLifecycleState | null>(
    null,
  );
  // Local "I clicked stop, waiting for the abort to land" flag. The
  // cancel signal takes a beat to propagate through pi-agent → the
  // executor → ComfyUI / LLM clients. Without immediate visual
  // feedback the user assumes the click was ignored. Cleared when
  // bgStatus leaves 'running'.
  const [pendingCancel, setPendingCancel] = useState(false);

  // ── Background task runner integration ───────────────────────────
  //
  // kshana_run_to (and the upcoming kshana_regen / render_scene_bundle
  // dispatch tools) are now non-blocking on the kshana-core side —
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
  // from `window.kshana.runnerStatus()` — see the effect below. This
  // is the SINGLE source of truth for the header Stop button, so the
  // button reflects reality regardless of which tool pi-agent fired
  // to start the run.
  const [runnerActive, setRunnerActive] = useState(false);

  /**
   * Pi-agent oversight + VLM judge runtime toggles read from
   * AppSettings. They are GLOBAL — same value applies across all
   * projects. The chat-header buttons and the Settings panel both
   * write to AppSettings; main-process pushes the new values into
   * core's `oversightState` global on every change.
   *
   * Default to true when settings haven't loaded yet — matches
   * the "default ON" rule and avoids a flash-of-OFF on mount.
   */
  const appSettings = useAppSettings();
  const piOversight = appSettings.settings?.piOversight ?? true;
  const vlmJudge = appSettings.settings?.vlmJudge ?? true;
  // Tracks the id of the currently-streaming assistant message so
  // multiple `stream_chunk` events accumulate into one bubble instead
  // of creating a new bubble per chunk.
  const streamingMsgIdRef = useRef<string | null>(null);
  // toolCallId → toolName lookup, populated on tool_call and cleared
  // on tool_result. We use it in the stream_chunk handler to filter:
  // only the long-running kshana_* tools (kshana_run_to in
  // particular) surface their per-line progress in the chat. Internal
  // pi-agent tool output (bash, read, edit, grep …) gets dropped so
  // the chat doesn't get flooded with file listings and grep
  // results.
  const toolNameByCallIdRef = useRef<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session.sessionId) return;
    const mainId = session.sessionId;
    const unsubscribe = session.subscribe('*', (event: KshanaEvent) => {
      // Process events from EITHER the main session (user chat) or
      // the background-run session — they merge into one
      // chronological feed in the chat. Anything from another
      // session (none right now, but defend anyway) is ignored.
      if (event.sessionId !== mainId && event.sessionId !== bgSessionId) {
        return;
      }
      // The header Stop button is no longer driven by tool-name
      // sniffing here. The previous tool-name allowlist
      // (`LONG_RUNNING_KSHANA_TOOLS`) only flipped on for THREE
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
      );
    });
    return unsubscribe;
  }, [session.sessionId, session.subscribe, bgSessionId]);

  // Poll runnerStatus to drive `runnerActive`. The runner emits no
  // push events to the renderer today (only `runnerStatus` /
  // `runnerCancel` IPC), so polling is the path. An immediate fetch
  // happens on mount so a user who reopens the panel mid-run sees
  // Stop without waiting for the first interval tick.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await window.kshana.runnerStatus();
        if (!cancelled) setRunnerActive(!!status?.active);
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

  // Clear the local "Stopping…" flag once the runner reports idle.
  useEffect(() => {
    if (!runnerActive && pendingCancel) {
      setPendingCancel(false);
    }
  }, [runnerActive, pendingCancel]);

  // (was: bg-session teardown on project switch — no longer needed
  // since the BackgroundTaskRunner singleton handles task lifecycle
  // independent of session lifetime).

  useEffect(() => {
    if (!session.sessionId || !projectName) return;
    // Pass the absolute project directory so the embedded core
    // looks in the same parent the user opened from — even when
    // that's outside the kshana-ink package's default getProjectsDir().
    session.focusProject(projectName, projectDirectory ?? undefined).catch(() => {});
  }, [session.sessionId, projectName, projectDirectory, session.focusProject]);

  // Auto-scroll to the latest message. (jsdom in tests omits scrollIntoView.)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
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

  // Probe project.json to decide whether this project still needs the
  // setup wizard. Runs every time the user opens a different project.
  // Also classifies the project's lifecycle state (fresh / in_progress /
  // completed) so the CTA panel can show the right next-step prompt.
  useEffect(() => {
    setSetupProbeCompleted(false);
    setIsSetupConfigured(false);
    setProjectState(null);
    if (!projectDirectory) return;
    let cancelled = false;
    const reader = {
      readFile: (p: string) => window.electron.project.readFile(p),
    };
    (async () => {
      const [persisted, lifecycle] = await Promise.all([
        loadPersistedProjectSetup(projectDirectory, reader),
        classifyProjectState(projectDirectory, reader),
      ]);
      if (cancelled) return;
      if (persisted) {
        setIsSetupConfigured(true);
        setSelectedTemplateId(persisted.templateId);
        setSelectedStyleId(persisted.style);
        setSelectedDuration(persisted.duration);
      } else {
        // Reset selections to defaults so the wizard starts clean.
        setSelectedTemplateId(WIZARD_DEFAULT_TEMPLATE_ID);
        setSelectedStyleId(WIZARD_DEFAULT_STYLE_ID);
        setSelectedDuration(WIZARD_DEFAULT_DURATION_SECONDS);
        setStoryInput('');
      }
      setProjectState(lifecycle);
      setSetupProbeCompleted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDirectory]);

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

  // Auto-spawn the wizard for fresh projects. The shared
  // shouldAutoOpenWizard predicate keeps the trigger criteria honest.
  useEffect(() => {
    if (
      !shouldAutoOpenWizard({
        projectDirectory,
        isProjectSetupConfigured: isSetupConfigured,
        setupPanelMode,
        templateCatalogLoaded: setupProbeCompleted,
        isConfiguringProjectSetup: isConfiguringSetup,
      })
    ) {
      return;
    }
    setSetupError(null);
    setSetupStep('style');
    setSetupPanelMode('wizard');
  }, [
    projectDirectory,
    isSetupConfigured,
    setupPanelMode,
    setupProbeCompleted,
    isConfiguringSetup,
  ]);

  // ── Wizard step handlers ──────────────────────────────────────────

  const handleSelectStyle = useCallback((styleId: string) => {
    setSelectedStyleId(styleId);
    setSetupStep('duration');
  }, []);

  const handleSelectDuration = useCallback((duration: number) => {
    setSelectedDuration(duration);
    setSetupStep('story');
  }, []);

  const handleChangeStory = useCallback((value: string) => {
    setStoryInput(value);
  }, []);

  const handleConfirmSetup = useCallback(async () => {
    if (
      !projectDirectory ||
      !selectedTemplateId ||
      !selectedStyleId ||
      !selectedDuration
    ) {
      return;
    }
    const trimmedStory = storyInput.trim();
    if (!trimmedStory) {
      setSetupError('Please add a story or idea before continuing.');
      return;
    }

    setSetupError(null);
    setIsConfiguringSetup(true);

    // Persist style/duration/template into project.json so re-opening
    // this project later skips the wizard.
    const configResult = await session.configureProject({
      projectDir: projectDirectory,
      templateId: selectedTemplateId,
      style: selectedStyleId,
      duration: selectedDuration,
      // Autonomous mode is no longer surfaced in the UI — every run
      // is manual / interactive. configure_project still accepts the
      // flag, so we pass a fixed `false` rather than dropping the
      // field (keeps the server contract unchanged).
      autonomousMode: false,
    });
    if (!configResult.ok) {
      setSetupError(
        `Failed to save setup: ${configResult.error ?? 'unknown error'}`,
      );
      setIsConfiguringSetup(false);
      return;
    }

    // Build the kickoff and dispatch as a chat task; pi-agent will
    // route this to kshana_new with `existingDir` set to the
    // pre-created folder.
    const projectDirName =
      projectDirectory.split('/').pop()?.replace(/\.kshana$/i, '') ||
      projectName ||
      'project';
    const { message } = buildWizardKickoff({
      projectDir: projectDirectory,
      projectName: projectDirName,
      templateId: selectedTemplateId,
      style: selectedStyleId,
      duration: selectedDuration,
      story: trimmedStory,
    });
    if (!message) {
      setIsConfiguringSetup(false);
      return;
    }

    // Hide the panel before runTask so the chat takes the spotlight.
    setSetupPanelMode('hidden');
    setIsSetupConfigured(true);
    setIsConfiguringSetup(false);
    setStoryInput('');

    // Surface the user's intent in the chat as a regular user bubble,
    // matching the way handleSend renders typed input.
    setMessages((prev) => [
      ...prev,
      { id: newMessageId(), role: 'user', text: message },
    ]);
    streamingMsgIdRef.current = null;
    await session.runTask(message);
  }, [
    projectDirectory,
    projectName,
    selectedDuration,
    selectedStyleId,
    selectedTemplateId,
    session,
    storyInput,
  ]);

  const handleSubmitStory = useCallback(() => {
    void handleConfirmSetup();
  }, [handleConfirmSetup]);

  // Autonomous-mode toggle was removed from the UI; the wizard panel
  // still requires the prop, so this is a fixed no-op that keeps the
  // selection visually pinned to "manual".
  const handleSelectAutonomousMode = useCallback((_enabled: boolean) => {}, []);

  const handleSetupBack = useCallback(() => {
    if (setupStep === 'duration') setSetupStep('style');
    else if (setupStep === 'story') setSetupStep('duration');
  }, [setupStep]);

  const handleOpenSetupWizard = useCallback(() => {
    setSetupError(null);
    setSetupStep('style');
    setSetupPanelMode('wizard');
  }, []);

  const handleEditSetup = useCallback(() => {
    handleOpenSetupWizard();
  }, [handleOpenSetupWizard]);

  // Template selection is stubbed — the embedded wizard hides the
  // template step entirely (template defaults to 'narrative').
  const handleSelectTemplate = useCallback(() => {}, []);

  const handleAttachClick = async () => {
    setAttachmentError(null);
    try {
      const result = await window.electron.project.selectAttachment({
        kinds: ['comfy_workflow'],
        title: 'Select a ComfyUI Workflow',
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
    const visibleText = chatAttachments.length > 0
      ? `${text}${text ? '\n\n' : ''}📎 ${chatAttachments.map(a => a.name).join(', ')}`
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

    const result = await session.runTask(text, {
      attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
    });
    if (!result.ok) {
      // Don't let a failed dispatch leave the chat in a "user
      // typed, nothing happened" state — surface the error so the
      // user can react (retry, restart, etc).
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'system',
          text: `Couldn't reach the agent: ${result.error ?? 'unknown error'}.`,
        },
      ]);
    }
  };

  /**
   * Toggle pi-agent oversight via AppSettings. The change is global —
   * applies to all projects. Main-process pushes the new value into
   * core's `oversightState` global on settings:update so the runtime
   * picks it up on the next task dispatch (and via `setVLMEnabled`
   * mid-run for VLM).
   *
   * VLM follows: when supervisor flips off the VLM toggle becomes a
   * no-op (UI disabled, runtime gate also off) but its stored value
   * is preserved so flipping supervisor back on restores the prior
   * choice.
   */
  const handleTogglePiOversight = useCallback(async () => {
    const next = !piOversight;
    await appSettings.saveConnectionSettings({ piOversight: next });
  }, [piOversight, appSettings]);

  const handleToggleVlmJudge = useCallback(async () => {
    if (!piOversight) return; // VLM is gated by supervisor; UI is disabled, but defend.
    const next = !vlmJudge;
    await appSettings.saveConnectionSettings({ vlmJudge: next });
  }, [piOversight, vlmJudge, appSettings]);

  const handleCancel = useCallback(async () => {
    // Cancel goes directly through the BackgroundTaskRunner IPC,
    // independent of any chat session. The runner aborts whatever
    // long task it currently has active and emits a 'cancelled'
    // event back to the originating session — same code path as a
    // natural completion. The Stop button stays instant even when
    // the main session's pi-agent is mid-reply.
    setPendingCancel(true);
    await window.kshana.runnerCancel().catch(() => undefined);
  }, []);

  // Build the "resume the pipeline" task and run it on the MAIN
  // session. kshana-core's pi-agent will receive it, call
  // kshana_run_to, which now dispatches to the BackgroundTaskRunner
  // and returns immediately — keeping this chat session free for
  // follow-up questions while the run streams progress in parallel.
  // (Was a separate bg session in an earlier iteration; the runner
  // singleton replaces that mechanism.)
  const handleStartRun = useCallback(async () => {
    if (!projectDirectory || !session.sessionId) return;
    setBgSessionId(session.sessionId);

    const projectDirName =
      projectDirectory.split('/').pop()?.replace(/\.kshana$/i, '') ||
      projectName ||
      'project';
    const params = `project="${projectDirName}" projectDir="${projectDirectory}"`;
    const task = `Continue running the kshana pipeline for ${params} all the way to completion. Use kshana_run_to with no stage so it runs to the end. Stream progress as nodes finish.`;

    setMessages((prev) => [
      ...prev,
      {
        id: newMessageId(),
        role: 'system',
        text: 'Resuming pipeline run…',
      },
    ]);
    streamingMsgIdRef.current = null;
    await session.runTask(task);
  }, [projectDirectory, projectName, session]);

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

  const handleSelectOption = useCallback(async (questionId: string, option: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === questionId ? { ...m, answered: true } : m)),
    );
    await session.sendResponse(option);
  }, [session]);

  // Single source of truth: the BackgroundTaskRunner. If it reports
  // a task active, the header shows Stop. Optimistic `pendingCancel`
  // also keeps the button in its "Stopping…" state during the brief
  // window between click and the runner actually winding down.
  const isRunning = runnerActive || pendingCancel;
  // Main-session readiness gates the textarea / send button. We
  // explicitly DON'T factor bgStatus in here — the user must be able
  // to chat while the long pipeline runs.
  const isReady =
    session.sessionId !== null && session.status !== 'connecting';
  // The main session's own loop ('running' while it processes a user
  // turn). Used to disable Send during that brief window so we don't
  // pile prompts on top of each other in pi-agent.
  const isMainBusy = session.status === 'running';

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
                    'Clear chat history?\n\nThis deletes the saved transcript on disk and starts a new session. Project files are not affected.',
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
            Pi-agent oversight toggle. Eye when on (watching),
            EyeOff when off. Click flips the local state + persists
            via IPC. Independent of the VLM toggle in storage; the
            VLM toggle's enabled-state mirrors this one.
          */}
          <button
            type="button"
            aria-label={
              piOversight
                ? 'Agent oversight: ON (click to turn off)'
                : 'Agent oversight: OFF (click to turn on)'
            }
            title={
              piOversight
                ? 'Agent oversight: ON — auto-engages on runner events'
                : 'Agent oversight: OFF — chat-only, no auto-engagement'
            }
            onClick={() => void handleTogglePiOversight()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              borderRadius: 6,
              border: '1px solid var(--color-border-subtle)',
              background: piOversight
                ? 'rgba(var(--color-accent-primary-rgb), 0.18)'
                : 'transparent',
              color: piOversight
                ? 'var(--color-accent-primary)'
                : 'var(--color-text-muted)',
              cursor: 'pointer',
              transition: 'background 120ms ease, color 120ms ease',
            }}
          >
            {piOversight ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          {/*
            VLM judge toggle. Disabled when supervisor is off (VLM
            standalone has no consumer). Tooltip explains the
            dependency. Always renders — disabled state is an
            obvious affordance, not a hidden control.
          */}
          <button
            type="button"
            disabled={!piOversight}
            aria-label={
              !piOversight
                ? 'VLM judge — turn supervisor on first'
                : vlmJudge
                  ? 'VLM judge: ON (click to turn off)'
                  : 'VLM judge: OFF (click to turn on)'
            }
            title={
              !piOversight
                ? 'VLM judge — turn supervisor on first'
                : vlmJudge
                  ? 'VLM judge: ON — vision-LLM describes generated images for the agent'
                  : 'VLM judge: OFF — agent has no vision feedback on assets'
            }
            onClick={() => void handleToggleVlmJudge()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              borderRadius: 6,
              border: '1px solid var(--color-border-subtle)',
              background: !piOversight
                ? 'transparent'
                : vlmJudge
                  ? 'rgba(var(--color-accent-primary-rgb), 0.18)'
                  : 'transparent',
              color: !piOversight
                ? 'var(--color-text-muted)'
                : vlmJudge
                  ? 'var(--color-accent-primary)'
                  : 'var(--color-text-muted)',
              cursor: piOversight ? 'pointer' : 'not-allowed',
              opacity: piOversight ? 1 : 0.45,
              transition: 'background 120ms ease, color 120ms ease, opacity 120ms ease',
            }}
          >
            <ScanEye size={14} />
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
            <span style={{ textTransform: 'capitalize' }}>{session.status}</span>
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

      <ProjectSetupPanel
        mode={setupPanelMode}
        step={setupStep}
        templates={WIZARD_TEMPLATES}
        durationPresets={WIZARD_DURATION_PRESETS}
        selectedTemplateId={selectedTemplateId}
        selectedStyleId={selectedStyleId}
        selectedDuration={selectedDuration}
        selectedAutonomousMode={false}
        storyInput={storyInput}
        loading={false}
        configuring={isConfiguringSetup}
        error={setupError}
        onOpenWizard={handleOpenSetupWizard}
        onEditSetup={handleEditSetup}
        onSelectTemplate={handleSelectTemplate}
        onSelectStyle={handleSelectStyle}
        onSelectDuration={handleSelectDuration}
        onChangeStory={handleChangeStory}
        onSubmitStory={handleSubmitStory}
        onSelectAutonomousMode={handleSelectAutonomousMode}
        onConfirmSetup={() => void handleConfirmSetup()}
        onBack={handleSetupBack}
      />

      <div className={styles.messageList}>
        {messages.length === 0 && setupPanelMode === 'hidden' && projectState === null ? (
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
            ) : (
              <MessageRow
                key={item.message.id}
                message={item.message}
                projectDirectory={projectDirectory}
              />
            ),
          )
        )}
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
          setupPanelMode === 'hidden' &&
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
            onChange={(e) => setInput(e.target.value)}
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
                if (input.trim().length > 0 || chatAttachments.length > 0) handleSend();
              }
            }}
            className={styles.textarea}
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
            disabled={!isReady || (input.trim().length === 0 && chatAttachments.length === 0)}
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

function statusGlyph(status: ToolStatus | undefined): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'error':
      return '✗';
    case 'in_progress':
    default:
      return '⋯';
  }
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
        <div key={row.id} aria-label="Run progress" className={styles.progressRow}>
          {row.progressText}
        </div>
      ))}
    </div>
  );
}

function MessageRow({
  message: m,
  projectDirectory,
}: {
  message: ChatMessage;
  projectDirectory: string | null;
}) {
  if (m.role === 'tool') {
    // Compact one-liner: glyph + monospaced tool name + faint args.
    // Per-line progress for long-running tools (e.g. kshana_run_to)
    // streams in as separate `progress` rows, one per chunk —
    // rendered just below this row by the parent message list.
    return (
      <div className={styles.toolRow}>
        <span className={styles.toolGlyph} data-status={m.toolStatus ?? 'in_progress'}>
          {statusGlyph(m.toolStatus)}
        </span>
        <span className={styles.toolName}>{m.toolName}</span>
        {m.toolArgsSummary && (
          <span className={styles.toolArgs}>{m.toolArgsSummary}</span>
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
    return <div className={styles.systemPill}>{m.text}</div>;
  }
  if (m.role === 'phase') {
    return (
      <div aria-label="Phase transition" className={styles.phaseRow}>
        ▶ {m.text}
      </div>
    );
  }
  if (m.role === 'media') {
    const resolvedSrc = m.mediaPath
      ? resolveMediaSrc(m.mediaPath, projectDirectory)
      : '';
    return (
      <div className={styles.mediaRow}>
        <div className={styles.mediaLabel}>
          generated {m.mediaKind} · {m.mediaProject ?? ''}
        </div>
        {m.mediaKind === 'image' && resolvedSrc ? (
          <img
            src={resolvedSrc}
            alt={`${m.mediaProject ?? ''} ${m.mediaPath}`}
            className={styles.mediaImage}
            style={{ maxWidth: 240 }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : m.mediaKind === 'video' && resolvedSrc ? (
          <video
            src={resolvedSrc}
            controls
            preload="metadata"
            style={{ maxWidth: '220px', borderRadius: 4 }}
          />
        ) : (
          <div style={{ fontSize: 12 }}>📁 {m.mediaPath}</div>
        )}
      </div>
    );
  }
  // user / assistant
  if (m.role === 'user') {
    return <div className={`${styles.bubble} ${styles.bubbleUser}`}>{m.text}</div>;
  }
  return (
    <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
      {/* Render-layer dedup as a safety net: the upstream LLM
          stream sometimes accumulates the same text twice
          (stream_chunk arriving with full content twice). Catching
          it here covers every code path that builds the bubble. */}
      <MarkdownContent text={dedupeDoubled(m.text ?? '')} />
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

function handleEvent(
  event: KshanaEvent,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  streamingMsgIdRef: React.RefObject<string | null>,
  setContextUsage: React.Dispatch<React.SetStateAction<ContextUsage | null>>,
  toolNameByCallIdRef: React.RefObject<Map<string, string>>,
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
      };
      // Update the matching tool card in place (NOT a new card).
      setMessages((prev) =>
        prev.map((m) =>
          m.role === 'tool' && m.toolCallId === data.toolCallId
            ? { ...m, toolStatus: data.isError ? 'error' : 'completed' }
            : m,
        ),
      );
      // Tool is done — drop the toolName entry to keep the map small.
      if (data.toolCallId) {
        toolNameByCallIdRef.current?.delete(data.toolCallId);
      }
      return;
    }
    case 'stream_chunk': {
      const data = event.data as { content?: string; done?: boolean; toolCallId?: string };
      // tool_streaming events also use this channel — they include a
      // toolCallId. Each chunk gets its OWN row so the long
      // kshana_run_to log doesn't become one unreadable concatenated
      // blob. The originating tool card stays compact at the top of
      // the run; the per-line rows stream in below it (and naturally
      // interleave with any user chat that comes in mid-run).
      if (data.toolCallId) {
        // Filter: only kshana_* tools (kshana_run_to, kshana_render_*)
        // surface their per-line progress in the chat. Internal
        // pi-agent tool output (bash listings, file reads, grep
        // results, …) gets dropped — without this filter the chat
        // gets flooded with `ls -la` outputs and file dumps.
        const parentToolName = toolNameByCallIdRef.current?.get(
          data.toolCallId,
        );
        if (!parentToolName || !parentToolName.startsWith('kshana_')) {
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
          const lastTs = (
            last as ChatMessage & { _ts?: number } | undefined
          )?._ts;
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
          const lines = chunk.split('\n').map((s) => s.trim()).filter(Boolean);
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
            m.id === id ? { ...m, text: mergeStreamText(m.text, chunk, data.done) } : m,
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
          prev.map((m) => (m.id === id ? { ...m, text: finalOutput, streaming: false } : m)),
        );
        streamingMsgIdRef.current = null;
      } else {
        // streamingMsgIdRef was cleared mid-stream by a tool_call event,
        // but the streaming bubble may still be sitting in the messages
        // list. Find the most-recent one and finalize it in-place rather
        // than appending a second bubble with the same content.
        setMessages((prev) => {
          let streamingIdx = -1;
          for (let i = prev.length - 1; i >= 0; i -= 1) {
            if (prev[i].role === 'assistant' && prev[i].streaming) {
              streamingIdx = i;
              break;
            }
          }
          if (streamingIdx !== -1) {
            return prev.map((m, i) =>
              i === streamingIdx ? { ...m, text: finalOutput, streaming: false } : m,
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
      const data = event.data as { kind?: 'image' | 'video'; path?: string; project?: string };
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
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'system',
          text: `[${data.level ?? 'info'}] ${data.message}`,
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
      if (typeof data.used !== 'number' || typeof data.limit !== 'number') return;
      setContextUsage({ used: data.used, limit: data.limit });
      return;
    }
    default:
      return;
  }
}
