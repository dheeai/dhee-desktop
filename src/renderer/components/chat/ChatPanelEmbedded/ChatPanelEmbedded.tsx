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
  X,
} from 'lucide-react';
import { useKshanaSession } from '../../../hooks/useKshanaSession';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
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

let nextMessageId = 1;
function newMessageId(): string {
  return `msg-${nextMessageId++}`;
}

/**
 * Tool names whose execution is "the long pipeline" — running for
 * minutes to hours. The header Run/Stop button shows Stop while any
 * of these is in flight, regardless of which session dispatched it.
 */
const LONG_RUNNING_KSHANA_TOOLS = new Set([
  'kshana_run_to',
  'kshana_render_scene_bundle',
  'kshana_audit_fidelity',
]);

function isLongRunningKshanaTool(toolName: string | undefined): boolean {
  return !!toolName && LONG_RUNNING_KSHANA_TOOLS.has(toolName);
}

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // Header dropdown menu (project name → caret → menu) state.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ── New-project wizard state ──────────────────────────────────────
  // Auto-spawns when the user opens an unconfigured project. Collects
  // style → duration → story; on confirm, calls session.configureProject
  // (persists template/style/duration into project.json) then runs a
  // kickoff task that pi-agent routes to `kshana_new` with `existingDir`.
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
  // Tracks which session currently has a long-running kshana_* tool
  // executing (kshana_run_to in particular). Set when tool_call fires
  // for a long tool, cleared on tool_result. Drives the header Run/
  // Stop button so the button reflects the actual run state — even
  // if the user typed "continue the pipeline" into the MAIN session
  // (where pi-agent then dispatched kshana_run_to) rather than
  // clicking Resume.
  const [activeLongRunSessionId, setActiveLongRunSessionId] = useState<
    string | null
  >(null);
  // True from the moment the user clicks Stop until activeLongRunSessionId
  // clears. Same role as the old bg-only `pendingCancel` but bound to
  // the unified active-run state.
  const [bgStatus, setBgStatus] = useState<'idle' | 'cancelling'>('idle');
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
      // Sniff long-running kshana_* tool starts/ends to drive the
      // header Run/Stop button. We track them PER SESSION so a
      // run on the main session (because the user typed "continue
      // the pipeline") flips the same state as a run on the bg
      // session (clicked Resume). The button reflects "is anything
      // long actually running" rather than just "is the bg session
      // active".
      if (event.eventName === 'tool_call') {
        const data = event.data as {
          toolCallId?: string;
          toolName?: string;
          status?: string;
        };
        if (
          data.toolName &&
          isLongRunningKshanaTool(data.toolName) &&
          data.status !== 'completed' &&
          data.status !== 'error'
        ) {
          setActiveLongRunSessionId(event.sessionId);
        }
      } else if (event.eventName === 'tool_result') {
        const data = event.data as { toolCallId?: string };
        const toolName =
          data.toolCallId !== undefined
            ? toolNameByCallIdRef.current?.get(data.toolCallId)
            : undefined;
        if (toolName && isLongRunningKshanaTool(toolName)) {
          setActiveLongRunSessionId((prev) =>
            prev === event.sessionId ? null : prev,
          );
          setBgStatus('idle');
        }
      }
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

  // Clear the local "Stopping…" flag once the active long run has
  // actually wound down (no session has it active anymore).
  useEffect(() => {
    if (!activeLongRunSessionId && pendingCancel) {
      setPendingCancel(false);
    }
  }, [activeLongRunSessionId, pendingCancel]);

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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !session.sessionId) return;

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

    setMessages((prev) => [
      ...prev,
      { id: newMessageId(), role: 'user', text },
    ]);
    setInput('');
    streamingMsgIdRef.current = null;

    const result = await session.runTask(text);
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

  const handleCancel = useCallback(async () => {
    // Cancel goes directly through the BackgroundTaskRunner IPC,
    // independent of any chat session. The runner aborts whatever
    // long task it currently has active and emits a 'cancelled'
    // event back to the originating session — same code path as a
    // natural completion. The Stop button stays instant even when
    // the main session's pi-agent is mid-reply.
    setPendingCancel(true);
    setBgStatus('cancelling');
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

  // The header Run/Stop button reflects "is a long kshana_* run
  // active anywhere", regardless of which session dispatched it.
  // This way it shows Stop whether the user clicked Resume (bg
  // session) OR typed "continue the pipeline" into the main session
  // (and pi-agent decided to call kshana_run_to there).
  const isRunning =
    activeLongRunSessionId !== null || bgStatus === 'cancelling';
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-base, #0d0e10)',
        color: 'var(--text-primary, #e3e3e3)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 14,
      }}
    >
      {/* Animation for the Loader2 "Stopping…" spinner. The codebase
          uses inline styles (no styled-components / Tailwind) so we
          inject the keyframe via a contained <style> block. */}
      <style>{`
        @keyframes kshana-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        .kshana-spin { animation: kshana-spin 800ms linear infinite; }
      `}</style>
      <header
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #2a2c30',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div ref={menuWrapperRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Project menu"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              margin: '-4px -8px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {headerProjectName}
            </span>
            <ChevronDown
              size={14}
              style={{
                opacity: 0.6,
                transform: menuOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 120ms ease',
              }}
            />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="Project actions"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                minWidth: 180,
                background: '#1a1c20',
                border: '1px solid #2a2c30',
                borderRadius: 6,
                padding: 4,
                boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                zIndex: 10,
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void handleExport();
                }}
                disabled={!isReady || messages.length === 0}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  cursor: messages.length === 0 ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  opacity: messages.length === 0 ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (messages.length > 0)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'rgba(255,255,255,0.05)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'transparent';
                }}
              >
                <Download size={14} />
                Export chat
              </button>
            </div>
          )}
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <ProjectRunButton
            projectState={projectState}
            running={isRunning}
            ready={isReady}
            pendingCancel={pendingCancel}
            onStart={() => void handleStartRun()}
            onCancel={() => void handleCancel()}
          />
          <div
            aria-label={`Status: ${session.status}`}
            title={
              session.error
                ? `Error: ${session.error}`
                : `Status: ${session.status}`
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              opacity: 0.65,
            }}
          >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background:
                session.status === 'error' || connectionError
                  ? '#d05a5a'
                  : isRunning
                    ? '#d4a72c'
                    : isReady
                      ? '#5cba6a'
                      : '#666',
              boxShadow: isRunning ? '0 0 6px #d4a72c' : 'none',
              transition: 'background 120ms ease',
            }}
          />
            <span style={{ textTransform: 'capitalize' }}>{session.status}</span>
          </div>
        </div>
      </header>

      {connectionError && (
        <div
          role="alert"
          aria-label="Connection error"
          style={{
            padding: '8px 14px',
            background: 'rgba(208,90,90,0.10)',
            borderBottom: '1px solid rgba(208,90,90,0.35)',
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            color: '#f0c4c4',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={13} />
            Connection error: {connectionError}
          </span>
          <button
            type="button"
            aria-label="Dismiss connection error"
            onClick={() => setConnectionError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: 2,
              display: 'inline-flex',
              alignItems: 'center',
            }}
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

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {messages.length === 0 && setupPanelMode === 'hidden' && projectState === null ? (
          // Probe still in flight — neutral placeholder so we don't
          // flash anything before classification completes.
          <div
            style={{
              opacity: 0.4,
              fontSize: 12,
              textAlign: 'center',
              marginTop: 32,
            }}
          >
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

      <footer
        style={{
          padding: 12,
          borderTop: '1px solid #2a2c30',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
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
        <div style={{ position: 'relative' }}>
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
                if (input.trim().length > 0) handleSend();
              }
            }}
            style={{
              width: '100%',
              background: 'var(--bg-elev, #1a1c20)',
              color: 'inherit',
              border: '1px solid #2a2c30',
              borderRadius: 10,
              // Bottom padding leaves room for the inline button
              // (32px button + 8px inset = 40 → round up to 44 for
              // a comfortable gap above the button).
              padding: '12px 56px 44px 14px',
              fontSize: 13,
              lineHeight: 1.45,
              resize: 'none',
              minHeight: 84,
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              outline: 'none',
              transition: 'border-color 120ms ease',
              display: 'block',
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLTextAreaElement).style.borderColor =
                'rgba(120,160,220,0.45)';
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLTextAreaElement).style.borderColor =
                '#2a2c30';
            }}
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
            disabled={!isReady || input.trim().length === 0}
            style={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              width: 32,
              height: 32,
              padding: 0,
              borderRadius: 8,
              border: 'none',
              cursor:
                !isReady || input.trim().length === 0
                  ? 'not-allowed'
                  : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
              background:
                input.trim().length > 0 && isReady ? '#3a7aa1' : '#2a2c30',
              color:
                input.trim().length > 0 && isReady ? '#fff' : '#7a8190',
              transition: 'background 120ms ease, color 120ms ease',
              boxSizing: 'border-box',
            }}
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
        {contextPct !== null && (
          <div
            aria-label="Context usage"
            style={{
              fontSize: 10,
              color: contextPct >= 80 ? '#d05a5a' : '#7a8190',
              opacity: 0.85,
              fontVariantNumeric: 'tabular-nums',
            }}
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
    <div
      style={{
        background: 'rgba(100,140,200,0.10)',
        border: '1px solid rgba(100,140,200,0.25)',
        borderRadius: 8,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>{m.question}</div>
      {m.options && m.options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {m.options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={m.answered}
              onClick={() => onSelect(opt)}
              style={{
                background: 'rgba(100,140,200,0.2)',
                border: '1px solid rgba(100,140,200,0.4)',
                borderRadius: 4,
                color: 'inherit',
                cursor: m.answered ? 'default' : 'pointer',
                fontSize: 12,
                padding: '3px 10px',
                opacity: m.answered ? 0.5 : 1,
              }}
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

function statusColor(status: ToolStatus | undefined): string {
  switch (status) {
    case 'completed':
      return '#5cba6a';
    case 'error':
      return '#d05a5a';
    case 'in_progress':
    default:
      return '#a08a3a';
  }
}

/**
 * Render a single progress line with the muted styling. Extracted so
 * both the standalone path (legacy / orphan progress rows) and the
 * grouped collapsible accordion render identical bubbles — keeps the
 * "muted, monospaced, indented" treatment in one place.
 */
function ProgressRow({ text }: { text: string | undefined }) {
  return (
    <div
      aria-label="Run progress"
      style={{
        marginLeft: 18,
        padding: '4px 10px',
        background: 'rgba(255,255,255,0.025)',
        borderLeft: '2px solid rgba(255,255,255,0.12)',
        borderRadius: 3,
        fontSize: 11,
        lineHeight: 1.4,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        color: '#a8b0bd',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </div>
  );
}

/**
 * Collapsible group for consecutive progress rows under one
 * kshana_run_to (or other long-running) tool call. Default state is
 * COLLAPSED so the chat doesn't drown in per-step heartbeat lines —
 * the user sees only the most recent step plus an "N steps" expander
 * button. Click expands; click again collapses.
 */
function ProgressGroup({ rows }: { rows: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  const last = rows[rows.length - 1];
  const count = rows.length;
  const buttonStyle: React.CSSProperties = {
    marginLeft: 18,
    marginTop: 2,
    padding: '2px 8px',
    background: 'transparent',
    border: 'none',
    color: '#7a8190',
    fontSize: 10,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    cursor: 'pointer',
    textAlign: 'left',
  };
  return (
    <div aria-label="Run progress group">
      {expanded ? (
        <>
          {rows.map((r) => (
            <ProgressRow key={r.id} text={r.progressText} />
          ))}
          <button
            aria-label="Collapse run progress"
            onClick={() => setExpanded(false)}
            style={buttonStyle}
            type="button"
          >
            ▴ collapse {count} step{count === 1 ? '' : 's'}
          </button>
        </>
      ) : (
        <>
          {last && <ProgressRow text={last.progressText} />}
          {count > 1 && (
            <button
              aria-label="Expand run progress"
              onClick={() => setExpanded(true)}
              style={buttonStyle}
              type="button"
            >
              ▾ show {count} step{count === 1 ? '' : 's'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

interface ProgressGroupItem {
  kind: 'progressGroup';
  id: string;
  toolCallId: string;
  rows: ChatMessage[];
}

interface MessageItem {
  kind: 'message';
  message: ChatMessage;
}

type RenderItem = ProgressGroupItem | MessageItem;

/**
 * Walk the flat message list once and fold consecutive progress rows
 * sharing the same parent toolCallId into a single accordion item.
 * Pure helper — exported only conceptually (no consumers outside this
 * file). Kept as a free function so it's trivially memoizable.
 */
function groupConsecutiveProgress(messages: ChatMessage[]): RenderItem[] {
  const out: RenderItem[] = [];
  for (const m of messages) {
    if (m.role === 'progress' && m.progressForToolCallId) {
      const last = out[out.length - 1];
      if (
        last &&
        last.kind === 'progressGroup' &&
        last.toolCallId === m.progressForToolCallId
      ) {
        last.rows.push(m);
        continue;
      }
      out.push({
        kind: 'progressGroup',
        id: `pg-${m.id}`,
        toolCallId: m.progressForToolCallId,
        rows: [m],
      });
      continue;
    }
    out.push({ kind: 'message', message: m });
  }
  return out;
}

function resolveMediaSrc(path: string, projectDirectory: string | null): string {
  // ExecutorAgent emits project-relative paths (assets/images/foo.png)
  // in tool_result.file_path. Resolving them here against the open
  // workspace project's absolute dir yields a file:// URL the Electron
  // renderer can actually load — without this prefix the <img> 404s
  // and gets hidden by onError, matching the "shows path but never
  // the actual asset" report.
  if (path.startsWith('/')) return `file://${path}`;
  if (projectDirectory) return `file://${projectDirectory}/${path}`;
  return `file://${path}`;
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
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          padding: '2px 4px',
          opacity: 0.85,
          fontSize: 11,
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        }}
      >
        <span style={{ color: statusColor(m.toolStatus), width: 12 }}>
          {statusGlyph(m.toolStatus)}
        </span>
        <span style={{ color: '#9aa3b2' }}>{m.toolName}</span>
        {m.toolArgsSummary && (
          <span style={{ opacity: 0.55, fontSize: 10 }}>{m.toolArgsSummary}</span>
        )}
      </div>
    );
  }
  if (m.role === 'progress') {
    // Standalone (un-grouped) progress row — falls through to the
    // shared ProgressRow renderer. The normal grouped path
    // (kshana_run_to with N stream_chunks) is rendered by
    // ProgressGroup at the parent level.
    return <ProgressRow text={m.progressText} />;
  }
  if (m.role === 'system') {
    // Compact "the user just took an action" pill — used for things
    // like "Resuming pipeline run…" or CTA labels. Distinct enough
    // from chat bubbles that the eye reads it as metadata, not as
    // either party speaking.
    return (
      <div
        style={{
          alignSelf: 'center',
          padding: '4px 12px',
          fontSize: 11,
          color: '#9aa3b2',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 999,
          fontWeight: 500,
          letterSpacing: 0.2,
        }}
      >
        {m.text}
      </div>
    );
  }
  if (m.role === 'phase') {
    return (
      <div
        aria-label="Phase transition"
        style={{
          padding: '3px 8px',
          fontSize: 11,
          background: 'rgba(100,100,200,0.12)',
          borderLeft: '2px solid rgba(100,100,200,0.5)',
          color: 'rgba(180,180,255,0.85)',
        }}
      >
        ▶ {m.text}
      </div>
    );
  }
  if (m.role === 'media') {
    const resolvedSrc = m.mediaPath
      ? resolveMediaSrc(m.mediaPath, projectDirectory)
      : '';
    return (
      <div style={messageBubbleStyle('rgba(80,160,80,0.10)', 'flex-start')}>
        <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>
          generated {m.mediaKind} · {m.mediaProject ?? ''}
        </div>
        {m.mediaKind === 'image' && resolvedSrc ? (
          <img
            src={resolvedSrc}
            alt={`${m.mediaProject ?? ''} ${m.mediaPath}`}
            // Compact thumbnail — full-width assets dominated the chat
            // panel and made each generation feel "heavy". Click to
            // open in a system viewer if the user wants the real size.
            style={{ maxWidth: '220px', borderRadius: 4, cursor: 'zoom-in' }}
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
  return (
    <div
      style={{
        ...messageBubbleStyle(
          m.role === 'user' ? 'rgba(80,140,200,0.18)' : 'rgba(255,255,255,0.04)',
          m.role === 'user' ? 'flex-end' : 'flex-start',
        ),
        maxWidth: '85%',
      }}
    >
      {m.role === 'assistant' ? (
        // Render-layer dedup as a safety net: the upstream LLM
        // stream sometimes accumulates the same text twice
        // (stream_chunk arriving with full content twice). Catching
        // it here covers every code path that builds the bubble.
        <MarkdownContent text={dedupeDoubled(m.text ?? '')} />
      ) : (
        <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
      )}
    </div>
  );
}

function MarkdownContent({ text }: { text: string }) {
  // remark-gfm gives us tables, strikethrough, autolinks, task lists.
  const components = useMemo(
    () => ({
      // Tighten heading + paragraph spacing for chat density.
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
      code: (props: React.HTMLAttributes<HTMLElement>) => (
        <code
          style={{
            background: 'rgba(255,255,255,0.06)',
            padding: '1px 4px',
            borderRadius: 3,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            fontSize: '0.92em',
          }}
          {...props}
        />
      ),
      pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
        <pre
          style={{
            background: 'rgba(255,255,255,0.06)',
            padding: 8,
            borderRadius: 4,
            overflowX: 'auto',
            margin: '6px 0',
            fontSize: 12,
          }}
          {...props}
        />
      ),
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props} target="_blank" rel="noreferrer" style={{ color: '#7eb6ff' }} />
      ),
    }),
    [],
  );
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function messageBubbleStyle(bg: string, align: 'flex-start' | 'flex-end'): React.CSSProperties {
  return {
    background: bg,
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: '6px 10px',
    color: 'inherit',
    alignSelf: align,
  };
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
      streamingMsgIdRef.current = null;
      // Record the toolName so subsequent stream_chunk events can
      // filter by it.
      if (data.toolCallId && data.toolName) {
        toolNameByCallIdRef.current?.set(data.toolCallId, data.toolName);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: 'tool',
          toolCallId: data.toolCallId,
          toolName: data.toolName ?? '(unknown tool)',
          toolStatus: data.status ?? 'in_progress',
          toolArgsSummary: summarizeArgs(data.arguments),
        },
      ]);
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
            m.id === id ? { ...m, text: (m.text ?? '') + chunk } : m,
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
      // with the canonical final string. Otherwise append a new
      // assistant bubble.
      const id = streamingMsgIdRef.current;
      if (id) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, text: finalOutput, streaming: false } : m)),
        );
        streamingMsgIdRef.current = null;
      } else {
        setMessages((prev) => [
          ...prev,
          { id: newMessageId(), role: 'assistant', text: finalOutput },
        ]);
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
