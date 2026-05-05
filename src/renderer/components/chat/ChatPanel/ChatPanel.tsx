import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Bot, Download, Trash2 } from 'lucide-react';
import type { BackendState } from '../../../../shared/backendTypes';
import type { AppSettings } from '../../../../shared/settingsTypes';
import type {
  ChatExportPayload,
  ChatSnapshotUiState,
  PersistedChatMessage,
} from '../../../../shared/chatTypes';
import type {
  RemotionServerRenderRequest,
  RemotionServerRenderResult,
  RemotionServerRenderProgress,
} from '../../../../shared/remotionTypes';
import type { ChatMessage, ChatQuestionOption } from '../../../types/chat';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useAgent } from '../../../contexts/AgentContext';
import {
  createChatSnapshot,
  loadChatSnapshot,
  saveChatSnapshot,
} from '../../../services/chatPersistence';
import QuestionPrompt from '../QuestionPrompt';
import TodoPrompt from '../TodoPrompt';
import MessageList from '../MessageList';
import ChatInput from '../ChatInput';
import StatusBar, { AgentStatus } from '../StatusBar';
import ProjectSetupPanel, {
  type SetupDurationOption,
  type SetupPanelMode,
  type SetupStep,
  type SetupTemplateOption,
} from '../ProjectSetupPanel';
import {
  failExecutingToolCalls,
  isCancelAckStatus,
  settleExecutingToolCalls,
} from './chatPanelStopUtils';
import {
  applyDesktopRemotionQueryParams,
  extractIncomingFileOpPath,
  isAbsoluteWirePath,
} from './chatPanelPathProtocolUtils';
import {
  assembleRemoteFinalVideo,
  type TimelineAssemblyProgress,
  type TimelineAssemblyRequest,
  type TimelineAssemblyResult,
} from './remoteFinalVideoAssembly';
import { getDisconnectBannerMessage } from './chatPanelConnectionUtils';
import { getImmediateAutoQuestionResponse } from './chatPanelQuestionUtils';
import {
  getResumedSessionUiState,
  shouldConfigureProjectAfterConnect,
  type RemoteSessionInfo,
} from './chatPanelResumeUtils';
import {
  findActiveToolCallEntry,
  mergeToolStreamingContent,
  normalizeComparableChatText,
  normalizeTodoUpdatePayload,
  shouldStreamToToolCallCard,
  shouldSuppressAgentResponse,
} from './chatPanelStreamUtils';
import {
  getPostToolUiState,
  getRemoteFsReconnectMessage,
} from './chatPanelToolStatusUtils';
import {
  isChatRestoreCompleteForProject as isChatRestoreCompleteForProjectState,
  shouldAutoConnectChat,
  shouldPersistChatSnapshot,
  type ChatRestoreState,
  type ChatRestoreStatus,
} from './chatPanelPersistenceUtils';
import useQuestionTimerCancellation from './useQuestionTimerCancellation';
import {
  getBackendBaseUrlForSettings,
  getBackendStateForSettings,
} from '../../../utils/backendModeGuard';
import { pathBasename } from '../../../utils/pathNormalizer';
import styles from './ChatPanel.module.scss';

// Message types that shouldn't create new messages if same type already exists
const DEDUPE_TYPES = ['progress', 'comfyui_progress', 'error'];
const backgroundGenerationEventDedupe = new Set<string>();

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

const DEFAULT_WS_PATH = '/api/v1/ws/chat';
const SNAPSHOT_SAVE_DEBOUNCE_MS = 500;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const OUTBOUND_ACTION_QUEUE_CAP = 200;
const CONNECTION_BANNER_DEDUPE_MS = 5000;
const STOP_ACK_TIMEOUT_MS = 12000;
const SETTINGS_RECONNECT_DEBOUNCE_MS = 400;
const PROJECT_SETUP_STORAGE_KEY = 'kshana.pendingProjectSetup';
const DEFAULT_SETUP_TEMPLATE_ID = 'narrative';
const DEFAULT_SETUP_STYLE_ID = 'cinematic_realism';
const DEFAULT_SETUP_DURATION_SECONDS = 120;
const NOTIFICATION_AUTO_CLEAR_MS = 8000;

interface ProjectSetupPersisted {
  version: 1;
  templateId: string;
  style: string;
  duration: number;
  autonomousMode?: boolean;
}

interface TemplateCatalogResponse {
  templates?: SetupTemplateOption[];
  durationPresets?: Record<string, SetupDurationOption[]>;
}

interface NotificationBannerState {
  level: 'info' | 'warning' | 'error';
  message: string;
}

interface SessionTimerState {
  visible: boolean;
  elapsedMs: number;
  running: boolean;
  completed: boolean;
}

interface ConfigureProjectPayload {
  templateId: string;
  style: string;
  duration: number;
  autonomousMode: boolean;
  projectDir: string;
  projectName?: string;
}

const FALLBACK_TEMPLATE_CATALOG: TemplateCatalogResponse = {
  templates: [
    {
      id: 'narrative',
      displayName: 'Narrative Story Video',
      description: 'Create a video from a story idea or complete narrative.',
      defaultStyle: DEFAULT_SETUP_STYLE_ID,
      styles: [
        {
          id: 'cinematic_realism',
          displayName: 'Cinematic Realism',
          description: 'Photorealistic cinematic style with dramatic lighting.',
        },
      ],
    },
  ],
  durationPresets: {
    narrative: [
      { label: '1 minute', seconds: 60 },
      { label: '2 minutes', seconds: 120 },
      { label: '3 minutes', seconds: 180 },
      { label: '5 minutes', seconds: 300 },
    ],
  },
};

const VALID_AGENT_STATUS: AgentStatus[] = [
  'idle',
  'thinking',
  'executing',
  'waiting',
  'completed',
  'error',
];

const makeId = () => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const resolvePreferredDuration = (
  templateId: string,
  durationPresets: Record<string, SetupDurationOption[]>,
): number => {
  const presets = durationPresets[templateId] || [];
  const explicitDefault = presets.find(
    (candidate) => candidate.seconds === DEFAULT_SETUP_DURATION_SECONDS,
  );
  return (
    explicitDefault?.seconds ??
    presets[0]?.seconds ??
    DEFAULT_SETUP_DURATION_SECONDS
  );
};

const normalizeProjectDirectory = (value: string): string => {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
};

const getProjectNameFromDirectory = (value: string): string => {
  return (
    normalizeProjectDirectory(value)
      .split('/')
      .pop()
      ?.replace(/\.kshana$/i, '') || value
  );
};

const ORIGINAL_INPUT_FILE = 'original_input.md';

const normalizeHttpUrl = (value?: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const resolveComfyUIOverride = (
  settings: AppSettings | null,
): string | null => {
  const mode = settings?.comfyuiMode ?? 'inherit';
  if (mode !== 'custom') {
    return null;
  }
  return normalizeHttpUrl(settings?.comfyuiUrl);
};

const getComfyUISettingsKey = (settings: AppSettings | null): string => {
  const mode = settings?.comfyuiMode ?? 'inherit';
  const override =
    mode === 'custom'
      ? (resolveComfyUIOverride(settings) ?? '__invalid__')
      : '__inherit__';
  return `${mode}:${override}`;
};

const normalizeNotificationLevel = (
  value: unknown,
): NotificationBannerState['level'] => {
  if (value === 'warning' || value === 'error') {
    return value;
  }
  return 'info';
};

const isReconnectStatusMessage = (content: string): boolean => {
  return content.startsWith('Reconnected');
};

const isNoRunningTaskCancelMessage = (message?: string): boolean => {
  return (
    typeof message === 'string' && /no running task to cancel/i.test(message)
  );
};

export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('disconnected');
  const [isStreaming, setIsStreaming] = useState(false);

  // New state for StatusBar
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [agentName, setAgentName] = useState('Kshana');
  const [statusMessage, setStatusMessage] = useState('');
  const [currentPhase, setCurrentPhase] = useState<string | undefined>();
  const [phaseDisplayName, setPhaseDisplayName] = useState<
    string | undefined
  >();
  const [hasUserSentMessage, setHasUserSentMessage] = useState(false);
  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const [isStopPending, setIsStopPending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [setupPanelMode, setSetupPanelMode] =
    useState<SetupPanelMode>('hidden');
  const [setupStep, setSetupStep] = useState<SetupStep>('template');
  const [setupTemplates, setSetupTemplates] = useState<SetupTemplateOption[]>(
    [],
  );
  const [setupDurationPresets, setSetupDurationPresets] = useState<
    Record<string, SetupDurationOption[]>
  >({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [autonomousModeEnabled, setAutonomousModeEnabled] = useState(false);
  const [questionTimerCancelledForId, setQuestionTimerCancelledForId] =
    useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isLoadingSetupCatalog, setIsLoadingSetupCatalog] = useState(false);
  const [isConfiguringProjectSetup, setIsConfiguringProjectSetup] =
    useState(false);
  const [isProjectSetupConfigured, setIsProjectSetupConfigured] =
    useState(false);
  const [notificationBanner, setNotificationBanner] =
    useState<NotificationBannerState | null>(null);
  const [sessionTimer, setSessionTimer] = useState<SessionTimerState>({
    visible: false,
    elapsedMs: 0,
    running: false,
    completed: false,
  });

  const { setConnectionStatus, projectDirectory, registerProjectSwitchGuard } =
    useWorkspace();
  const agentContext = useAgent();

  const wsRef = useRef<WebSocket | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);
  const lastFinalizedAssistantStreamTextRef = useRef<string>('');
  const connectingRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const awaitingResponseRef = useRef(false);
  // Track active tool calls by toolCallId or by toolName+sequence when toolCallId is missing
  const activeToolCallsRef = useRef<
    Map<string, { messageId: string; startTime: number; toolName: string }>
  >(new Map());
  const toolCallSequenceRef = useRef<Map<string, number>>(new Map());
  // Track the last todo message ID for in-place updates
  const lastTodoMessageIdRef = useRef<string | null>(null);
  // Track the last question message ID to avoid duplicates
  const lastQuestionMessageIdRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const settingsReconnectTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const comfyUISettingsKeyRef = useRef<string>('');
  const appSettingsRef = useRef<AppSettings | null>(null);
  const pendingOutboundActionsRef = useRef<string[]>([]);
  const snapshotSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const connectionBannerRef = useRef<{ key: string; at: number } | null>(null);
  const currentProjectDirectoryRef = useRef<string | null>(null);
  const lastMissingProjectRootWarningAtRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const chatRestoreStateRef = useRef<ChatRestoreState>({
    projectDirectory: null,
    status: 'idle',
  });
  const messagesRef = useRef<ChatMessage[]>([]);
  const agentStatusRef = useRef<AgentStatus>('idle');
  const agentNameRef = useRef('Kshana');
  const statusMessageRef = useRef('');
  const currentPhaseRef = useRef<string | undefined>(undefined);
  const phaseDisplayNameRef = useRef<string | undefined>(undefined);
  const hasUserSentMessageRef = useRef(false);
  const isTaskRunningRef = useRef(false);

  const isStopPendingRef = useRef(false);
  const autonomousModeRef = useRef(false);
  const supportsProjectStateSyncRef = useRef(true);
  const stopRequestRef = useRef<{
    promise: Promise<boolean>;
    resolve: (success: boolean) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);
  const isConfiguringProjectSetupRef = useRef(false);
  const sendClientActionRef = useRef<
    (message: Record<string, unknown>) => Promise<void>
  >(async () => {});

  const resolveAgentStatus = useCallback((value?: string): AgentStatus => {
    if (value && VALID_AGENT_STATUS.includes(value as AgentStatus)) {
      return value as AgentStatus;
    }
    return 'idle';
  }, []);

  const resetConversationRefs = useCallback(() => {
    lastAssistantIdRef.current = null;
    lastFinalizedAssistantStreamTextRef.current = '';
    awaitingResponseRef.current = false;
    activeToolCallsRef.current.clear();
    toolCallSequenceRef.current.clear();
    lastTodoMessageIdRef.current = null;
    lastQuestionMessageIdRef.current = null;
    backgroundGenerationEventDedupe.clear();
  }, []);

  const getChatRestoreState = useCallback((): ChatRestoreState => {
    return chatRestoreStateRef.current;
  }, []);

  const setChatRestoreState = useCallback(
    (projectDir: string | null, status: ChatRestoreStatus) => {
      chatRestoreStateRef.current = {
        projectDirectory: projectDir,
        status,
      };
      console.log('[ChatPanel] Chat restore state updated:', {
        projectDirectory: projectDir,
        status,
      });
    },
    [],
  );

  const isChatRestoreCompleteForProject = useCallback(
    (projectDir: string | null | undefined): boolean => {
      return isChatRestoreCompleteForProjectState(
        getChatRestoreState(),
        projectDir,
      );
    },
    [getChatRestoreState],
  );

  const shouldPersistSnapshotForProject = useCallback(
    (targetProjectDirectory: string | null | undefined): boolean => {
      return shouldPersistChatSnapshot({
        currentProjectDirectory: currentProjectDirectoryRef.current,
        targetProjectDirectory,
        restoreState: getChatRestoreState(),
      });
    },
    [getChatRestoreState],
  );
  const appendMessage = useCallback(
    (message: Omit<ChatMessage, 'id' | 'timestamp'> & Partial<ChatMessage>) => {
      const id = message.id ?? makeId();
      const timestamp = message.timestamp ?? Date.now();
      const newMessage = { ...message, id, timestamp };
      setMessages((prev) => {
        const updated = [...prev, newMessage];
        return updated;
      });
      return id;
    },
    [],
  );

  const updateToolCallStreamingContent = useCallback(
    (messageId: string, content: string, options?: { reset?: boolean }) => {
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) {
            return message;
          }

          const existingContent =
            typeof message.meta?.streamingContent === 'string'
              ? message.meta.streamingContent
              : '';
          const nextContent = mergeToolStreamingContent(
            existingContent,
            content,
            options,
          );

          return {
            ...message,
            meta: {
              ...(message.meta || {}),
              streamingContent: nextContent,
            },
            timestamp: Date.now(),
          };
        }),
      );
    },
    [],
  );

  const appendSystemMessage = useCallback(
    (content: string, type = 'status') => {
      if (type === 'status' && isReconnectStatusMessage(content)) {
        setMessages((prev) => {
          const filtered = prev.filter(
            (message) =>
              !(
                message.role === 'system' &&
                message.type === 'status' &&
                isReconnectStatusMessage(message.content)
              ),
          );

          return [
            ...filtered,
            {
              id: makeId(),
              role: 'system',
              type,
              content,
              timestamp: Date.now(),
            },
          ];
        });
        return;
      }

      // Dedupe progress messages - update last matching one within recent history
      if (DEDUPE_TYPES.includes(type)) {
        setMessages((prev) => {
          // Look back at the last 5 messages to find a match
          // This handles cases where a notification might interleave with progress updates
          const searchLimit = Math.min(prev.length, 5);
          const startIndex = prev.length - 1;

          for (let i = 0; i < searchLimit; i++) {
            const idx = startIndex - i;
            const msg = prev[idx];

            if (msg.role === 'system' && msg.type === type) {
              // Update existing message
              return prev.map((m, index) =>
                index === idx ? { ...m, content, timestamp: Date.now() } : m,
              );
            }
          }

          // Create new message if no match found
          const id = makeId();
          return [
            ...prev,
            { id, role: 'system', type, content, timestamp: Date.now() },
          ];
        });
        return;
      }
      appendMessage({
        role: 'system',
        type,
        content,
      });
    },
    [appendMessage],
  );

  useEffect(() => {
    messagesRef.current = messages;
    agentStatusRef.current = agentStatus;
    agentNameRef.current = agentName;
    statusMessageRef.current = statusMessage;
    currentPhaseRef.current = currentPhase;
    phaseDisplayNameRef.current = phaseDisplayName;
    hasUserSentMessageRef.current = hasUserSentMessage;
    isTaskRunningRef.current = isTaskRunning;
    isStopPendingRef.current = isStopPending;
    autonomousModeRef.current = autonomousModeEnabled;
    sessionIdRef.current = sessionId;
  }, [
    messages,
    agentStatus,
    agentName,
    statusMessage,
    currentPhase,
    phaseDisplayName,
    hasUserSentMessage,
    isTaskRunning,
    isStopPending,
    autonomousModeEnabled,
    sessionId,
  ]);

  useEffect(() => {
    isConfiguringProjectSetupRef.current = isConfiguringProjectSetup;
  }, [isConfiguringProjectSetup]);

  useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
    };
  }, []);

  const appendConnectionBanner = useCallback(
    (key: string, content: string) => {
      const now = Date.now();
      const lastBanner = connectionBannerRef.current;
      if (
        lastBanner &&
        lastBanner.key === key &&
        now - lastBanner.at < CONNECTION_BANNER_DEDUPE_MS
      ) {
        return;
      }
      connectionBannerRef.current = { key, at: now };
      appendSystemMessage(content, 'error');
    },
    [appendSystemMessage],
  );

  const fetchTemplateCatalog =
    useCallback(async (): Promise<TemplateCatalogResponse> => {
      const settings =
        appSettingsRef.current ??
        (await window.electron.settings.get().catch(() => null));
      const startedAt = Date.now();
      const READY_WAIT_MS = 10_000;

      // The project setup wizard often opens while the bundled backend is still starting.
      // Wait briefly for a ready state to avoid a noisy "Failed to fetch" UX.
      let backendState = await getBackendStateForSettings(settings);
      while (
        backendState.status !== 'ready' &&
        Date.now() - startedAt < READY_WAIT_MS
      ) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        backendState = await window.electron.backend.getState();
      }

      if (!backendState.serverUrl && backendState.status !== 'ready') {
        throw new Error(
          `Backend is not ready (status=${backendState.status}). ${
            backendState.message ?? ''
          }`.trim(),
        );
      }

      const baseUrl = await getBackendBaseUrlForSettings(settings, backendState);
      const url = `${baseUrl}/api/v1/templates`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
        });
      } catch (error) {
        const statusInfo = backendState.status
          ? `backend status=${backendState.status}`
          : 'backend status=unknown';
        throw new Error(
          `Failed to fetch templates from ${url} (${statusInfo}). ${
            error instanceof Error ? error.message : ''
          }`.trim(),
        );
      }

      if (!response.ok) {
        throw new Error(
          `Template request failed (${url}) with status ${response.status}`,
        );
      }

      const parsed = (await response.json()) as TemplateCatalogResponse;
      return {
        templates: parsed.templates || [],
        durationPresets: parsed.durationPresets || {},
      };
    }, []);

  const ensureTemplateCatalogLoaded = useCallback(async (): Promise<{
    templates: SetupTemplateOption[];
    durationPresets: Record<string, SetupDurationOption[]>;
  }> => {
    if (
      setupTemplates.length > 0 &&
      Object.keys(setupDurationPresets).length > 0
    ) {
      return {
        templates: setupTemplates,
        durationPresets: setupDurationPresets,
      };
    }

    setIsLoadingSetupCatalog(true);
    try {
      const catalog = await fetchTemplateCatalog();
      const templates =
        catalog.templates && catalog.templates.length > 0
          ? catalog.templates
          : FALLBACK_TEMPLATE_CATALOG.templates || [];
      const durationPresets =
        catalog.durationPresets &&
        Object.keys(catalog.durationPresets).length > 0
          ? catalog.durationPresets
          : FALLBACK_TEMPLATE_CATALOG.durationPresets || {};

      setSetupTemplates(templates);
      setSetupDurationPresets(durationPresets);
      setSetupError(null);
      return { templates, durationPresets };
    } catch (error) {
      const templates = FALLBACK_TEMPLATE_CATALOG.templates || [];
      const durationPresets = FALLBACK_TEMPLATE_CATALOG.durationPresets || {};
      setSetupTemplates(templates);
      setSetupDurationPresets(durationPresets);
      setSetupError(
        `Could not load setup options from backend. Using defaults. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
      );
      return { templates, durationPresets };
    } finally {
      setIsLoadingSetupCatalog(false);
    }
  }, [fetchTemplateCatalog, setupDurationPresets, setupTemplates]);

  const loadPersistedSetupForDirectory = useCallback(
    async (
      targetProjectDirectory: string,
    ): Promise<ProjectSetupPersisted | null> => {
      try {
        const content = await window.electron.project.readFile(
          `${targetProjectDirectory}/project.json`,
        );
        if (content) {
          const parsed = JSON.parse(content) as Partial<{
            templateId: unknown;
            style: unknown;
            duration: unknown;
            targetDuration: unknown;
            autonomousMode: unknown;
          }>;
          const duration =
            typeof parsed.targetDuration === 'number'
              ? parsed.targetDuration
              : parsed.duration;
          if (
            parsed &&
            typeof parsed.templateId === 'string' &&
            parsed.templateId.trim().length > 0 &&
            typeof parsed.style === 'string' &&
            parsed.style.trim().length > 0 &&
            typeof duration === 'number'
          ) {
            return {
              version: 1,
              templateId: parsed.templateId,
              style: parsed.style,
              duration,
              autonomousMode: Boolean(parsed.autonomousMode),
            };
          }
        }
      } catch {
        // Ignore malformed project.json
      }

      return null;
    },
    [],
  );

  const configureProjectSetup = useCallback(
    async (config: ConfigureProjectPayload): Promise<void> => {
      if (!projectDirectory) return;

      const normalizedConfig: ConfigureProjectPayload = {
        ...config,
        autonomousMode: Boolean(config.autonomousMode),
        projectName:
          config.projectName ?? getProjectNameFromDirectory(config.projectDir),
      };

      setSetupError(null);
      setIsConfiguringProjectSetup(true);
      setIsProjectSetupConfigured(false);
      try {
        await sendClientActionRef.current({
          type: 'configure_project',
          data: normalizedConfig,
        });
      } catch (error) {
        setSetupError(
          `Failed to configure project setup: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
        setIsConfiguringProjectSetup(false);
      }
    },
    [projectDirectory],
  );

  const openSetupWizard = useCallback(async () => {
    await ensureTemplateCatalogLoaded();
    setSetupError(null);
    setSetupPanelMode('wizard');
    setSetupStep('template');
  }, [ensureTemplateCatalogLoaded]);

  const loadPersistedSetup =
    useCallback(async (): Promise<ProjectSetupPersisted | null> => {
      if (!projectDirectory) {
        return null;
      }
      return loadPersistedSetupForDirectory(projectDirectory);
    }, [loadPersistedSetupForDirectory, projectDirectory]);

  const deriveDefaultSetup = useCallback(
    (
      templates: SetupTemplateOption[],
      durationPresets: Record<string, SetupDurationOption[]>,
    ): ConfigureProjectPayload | null => {
      const template =
        templates.find(
          (candidate) => candidate.id === DEFAULT_SETUP_TEMPLATE_ID,
        ) || templates[0];
      if (!template) return null;

      const style =
        template.styles.find(
          (candidate) => candidate.id === template.defaultStyle,
        )?.id ||
        template.styles.find(
          (candidate) => candidate.id === DEFAULT_SETUP_STYLE_ID,
        )?.id ||
        template.styles[0]?.id ||
        DEFAULT_SETUP_STYLE_ID;

      const duration = resolvePreferredDuration(template.id, durationPresets);

      if (!projectDirectory) return null;

      return {
        templateId: template.id,
        style,
        duration,
        autonomousMode: false,
        projectDir: projectDirectory,
        projectName: getProjectNameFromDirectory(projectDirectory),
      };
    },
    [projectDirectory],
  );

  const applySetupSelection = useCallback((config: ConfigureProjectPayload) => {
    setSelectedTemplateId(config.templateId);
    setSelectedStyleId(config.style);
    setSelectedDuration(config.duration);
    setAutonomousModeEnabled(config.autonomousMode);
  }, []);

  const buildSetupPayload = useCallback(
    (
      overrides: Partial<ConfigureProjectPayload> = {},
    ): ConfigureProjectPayload | null => {
      if (
        !projectDirectory ||
        !selectedTemplateId ||
        !selectedStyleId ||
        !selectedDuration
      ) {
        return null;
      }

      return {
        templateId: selectedTemplateId,
        style: selectedStyleId,
        duration: selectedDuration,
        autonomousMode: autonomousModeEnabled,
        projectDir: projectDirectory,
        projectName: getProjectNameFromDirectory(projectDirectory),
        ...overrides,
      };
    },
    [
      autonomousModeEnabled,
      projectDirectory,
      selectedDuration,
      selectedStyleId,
      selectedTemplateId,
    ],
  );

  const handleSelectTemplate = useCallback(
    (templateId: string) => {
      const template =
        setupTemplates.find((candidate) => candidate.id === templateId) || null;
      if (!template || !projectDirectory) return;

      const style =
        template.styles.find(
          (candidate) => candidate.id === template.defaultStyle,
        )?.id ||
        template.styles[0]?.id ||
        DEFAULT_SETUP_STYLE_ID;
      const duration = resolvePreferredDuration(
        templateId,
        setupDurationPresets,
      );

      setSelectedTemplateId(templateId);
      setSelectedStyleId(style);
      setSelectedDuration(duration);
      setAutonomousModeEnabled(false);
      setSetupStep('style');
    },
    [projectDirectory, setupDurationPresets, setupTemplates],
  );

  const handleSelectStyle = useCallback((styleId: string) => {
    setSelectedStyleId(styleId);
    setSetupStep('duration');
  }, []);

  const handleSelectDuration = useCallback(
    (duration: number) => {
      if (!projectDirectory || !selectedTemplateId || !selectedStyleId) {
        return;
      }

      setSelectedDuration(duration);
      setSetupPanelMode('wizard');
      setSetupStep('autonomous');
    },
    [projectDirectory, selectedStyleId, selectedTemplateId],
  );

  const handleSelectAutonomousMode = useCallback((enabled: boolean) => {
    setAutonomousModeEnabled(enabled);
  }, []);

  const handleConfirmSetup = useCallback(() => {
    const payload = buildSetupPayload();
    if (!payload) {
      return;
    }

    setSetupPanelMode('wizard');
    setSetupStep('autonomous');
    configureProjectSetup(payload).catch(() => undefined);
  }, [buildSetupPayload, configureProjectSetup]);

  const handleSetupBack = useCallback(() => {
    if (setupStep === 'style') {
      setSetupStep('template');
      return;
    }
    if (setupStep === 'duration') {
      setSetupStep('style');
      return;
    }
    if (setupStep === 'autonomous') {
      setSetupStep('duration');
    }
  }, [setupStep]);

  const handleSetupEdit = useCallback(async () => {
    await openSetupWizard();
  }, [openSetupWizard]);

  const resolveStopRequest = useCallback(
    (success: boolean, errorMessage?: string): boolean => {
      const pending = stopRequestRef.current;
      if (!pending) {
        return false;
      }

      clearTimeout(pending.timeoutId);
      stopRequestRef.current = null;
      setIsStopPending(false);

      if (success) {
        setIsTaskRunning(false);
      } else {
        const message = errorMessage || 'Failed to stop task.';
        const noRunningTask = isNoRunningTaskCancelMessage(message);
        setIsTaskRunning(!noRunningTask);
        if (noRunningTask) {
          setAgentStatus('idle');
          setStatusMessage('Ready');
        }
        appendSystemMessage(message, 'error');
      }

      pending.resolve(success);
      return true;
    },
    [appendSystemMessage],
  );

  const failActiveToolCalls = useCallback((reason: string) => {
    const now = Date.now();
    const activeEntries = Array.from(activeToolCallsRef.current.values());
    const updated = failExecutingToolCalls(
      messagesRef.current,
      activeEntries,
      reason,
      now,
    );

    messagesRef.current = updated;
    setMessages(updated);
    activeToolCallsRef.current.clear();
    toolCallSequenceRef.current.clear();
    setIsStreaming(false);
    lastAssistantIdRef.current = null;
    lastFinalizedAssistantStreamTextRef.current = '';
  }, []);

  const finalizeAssistantStream = useCallback((finalText?: string) => {
    const activeAssistantId = lastAssistantIdRef.current;
    if (!activeAssistantId) {
      if (finalText !== undefined) {
        lastFinalizedAssistantStreamTextRef.current =
          normalizeComparableChatText(finalText);
      }
      setIsStreaming(false);
      return;
    }

    const activeMessage = messagesRef.current.find(
      (message) =>
        message.id === activeAssistantId &&
        message.role === 'assistant' &&
        message.type !== 'tool_call',
    );

    const resolvedFinalText =
      finalText !== undefined
        ? finalText
        : activeMessage
          ? activeMessage.content
          : '';

    lastFinalizedAssistantStreamTextRef.current =
      normalizeComparableChatText(resolvedFinalText);
    lastAssistantIdRef.current = null;
    setIsStreaming(false);

    // Remove the active message if it never received any content (empty ghost bubble)
    if (
      activeAssistantId &&
      (!activeMessage || !activeMessage.content.trim())
    ) {
      setMessages((prev) => prev.filter((msg) => msg.id !== activeAssistantId));
    }
  }, []);

  const markExecutionInterrupted = useCallback(
    (statusText: string, toolReason: string, systemMessage?: string) => {
      finalizeAssistantStream();
      failActiveToolCalls(toolReason);

      const pending = stopRequestRef.current;
      if (pending) {
        clearTimeout(pending.timeoutId);
        stopRequestRef.current = null;
        pending.resolve(false);
      }

      setIsStopPending(false);
      setIsTaskRunning(false);
      setAgentStatus('waiting');
      setStatusMessage(statusText);
      setSessionTimer((prev) => ({
        ...prev,
        running: false,
      }));

      if (systemMessage) {
        appendSystemMessage(systemMessage, 'status');
      }
    },
    [appendSystemMessage, failActiveToolCalls, finalizeAssistantStream],
  );

  const settleActiveToolCalls = useCallback(
    (status: 'completed' | 'error', result: string) => {
      const now = Date.now();
      const activeEntries = Array.from(activeToolCallsRef.current.values());
      const updated = settleExecutingToolCalls(
        messagesRef.current,
        activeEntries,
        status,
        result,
        now,
      );

      if (updated === messagesRef.current) {
        return;
      }

      messagesRef.current = updated;
      setMessages(updated);
      activeToolCallsRef.current.clear();
      toolCallSequenceRef.current.clear();
      setIsStreaming(false);
      lastAssistantIdRef.current = null;
      lastFinalizedAssistantStreamTextRef.current = '';
    },
    [],
  );

  const getRendererErrorMessage = useCallback(
    (error: unknown, fallback: string): string => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
      ) {
        const message = (error as { message: string }).message.trim();
        if (message) {
          return message;
        }
      }
      return fallback;
    },
    [],
  );
  const buildSnapshotUiState = useCallback((): ChatSnapshotUiState => {
    return {
      agentStatus: agentStatusRef.current,
      agentName: agentNameRef.current,
      statusMessage: statusMessageRef.current,
      currentPhase: currentPhaseRef.current,
      phaseDisplayName: phaseDisplayNameRef.current,
      hasUserSentMessage: hasUserSentMessageRef.current,
      isTaskRunning: isTaskRunningRef.current,
      autonomousMode: autonomousModeRef.current,
    };
  }, []);

  const persistSnapshot = useCallback(
    async (targetProjectDirectory: string): Promise<void> => {
      const currentProjectDirectory = currentProjectDirectoryRef.current;
      if (!currentProjectDirectory) {
        return;
      }

      if (
        normalizeProjectDirectory(targetProjectDirectory) !==
        normalizeProjectDirectory(currentProjectDirectory)
      ) {
        // Skip stale snapshot writes scheduled before project root switched.
        return;
      }

      if (!shouldPersistSnapshotForProject(targetProjectDirectory)) {
        console.log(
          '[ChatPanel] Skipping snapshot persist until restore completes:',
          {
            targetProjectDirectory,
            restoreState: getChatRestoreState(),
          },
        );
        return;
      }

      const snapshot = createChatSnapshot({
        projectDirectory: targetProjectDirectory,
        sessionId: sessionIdRef.current,
        messages: messagesRef.current,
        uiState: buildSnapshotUiState(),
      });
      if (snapshot.messages.length === 0) {
        console.log(
          '[ChatPanel] Persisting empty chat snapshot after restore completion:',
          {
            projectDirectory: targetProjectDirectory,
            sessionId: snapshot.sessionId,
          },
        );
      }
      await saveChatSnapshot(snapshot);
    },
    [
      buildSnapshotUiState,
      getChatRestoreState,
      shouldPersistSnapshotForProject,
    ],
  );

  const scheduleSnapshotSave = useCallback(
    (targetProjectDirectory: string | null | undefined) => {
      if (!targetProjectDirectory) {
        return;
      }
      if (!shouldPersistSnapshotForProject(targetProjectDirectory)) {
        console.log(
          '[ChatPanel] Autosave suppressed while chat restore is pending:',
          {
            targetProjectDirectory,
            restoreState: getChatRestoreState(),
          },
        );
        return;
      }
      if (snapshotSaveTimeoutRef.current) {
        clearTimeout(snapshotSaveTimeoutRef.current);
      }
      snapshotSaveTimeoutRef.current = setTimeout(() => {
        snapshotSaveTimeoutRef.current = null;
        void persistSnapshot(targetProjectDirectory).catch((error) => {
          console.error('[ChatPanel] Failed to persist chat snapshot:', error);
        });
      }, SNAPSHOT_SAVE_DEBOUNCE_MS);
    },
    [getChatRestoreState, persistSnapshot, shouldPersistSnapshotForProject],
  );

  const hasQueuedOutboundActionType = useCallback((type: string): boolean => {
    return pendingOutboundActionsRef.current.some((payload) => {
      try {
        const parsed = JSON.parse(payload) as { type?: unknown };
        return parsed.type === type;
      } catch {
        return false;
      }
    });
  }, []);

  const removeQueuedOutboundActionType = useCallback((type: string): void => {
    pendingOutboundActionsRef.current =
      pendingOutboundActionsRef.current.filter((payload) => {
        try {
          const parsed = JSON.parse(payload) as { type?: unknown };
          return parsed.type !== type;
        } catch {
          return true;
        }
      });
  }, []);

  const fetchSessionInfo = useCallback(
    async (
      lookupSessionId: string,
      backendState: BackendState,
    ): Promise<RemoteSessionInfo | null> => {
      const settings =
        appSettingsRef.current ??
        (await window.electron.settings.get().catch(() => null));
      const baseUrl = await getBackendBaseUrlForSettings(
        settings,
        backendState,
      );
      const url = new URL(
        `/api/v1/sessions/${encodeURIComponent(lookupSessionId)}`,
        baseUrl,
      );

      try {
        const response = await fetch(url.toString(), {
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new Error(`Session lookup failed: ${response.status}`);
        }

        const payload = (await response.json()) as RemoteSessionInfo;
        if (
          !payload ||
          typeof payload.id !== 'string' ||
          typeof payload.status !== 'string'
        ) {
          return null;
        }

        return payload;
      } catch (error) {
        console.warn('[ChatPanel] Failed to fetch session info:', error);
        return null;
      }
    },
    [],
  );

  const syncProjectState = useCallback(
    async (
      socket?: WebSocket,
      targetProjectDirectory?: string | null,
    ): Promise<void> => {
      const activeSocket = socket ?? wsRef.current;
      if (
        !activeSocket ||
        activeSocket.readyState !== WebSocket.OPEN ||
        !targetProjectDirectory ||
        !supportsProjectStateSyncRef.current
      ) {
        return;
      }

      try {
        const snapshot = await window.electron.project.readProjectSnapshot(
          targetProjectDirectory,
        );
        activeSocket.send(
          JSON.stringify({
            type: 'project_state_sync',
            data: snapshot,
          }),
        );
      } catch (error) {
        console.warn('[ChatPanel] Failed to sync project state:', error);
      }
    },
    [],
  );

  const syncConfiguredProject = useCallback(
    async (
      socket?: WebSocket,
      targetProjectDirectory?: string | null,
    ): Promise<void> => {
      const activeSocket = socket ?? wsRef.current;
      if (
        !activeSocket ||
        activeSocket.readyState !== WebSocket.OPEN ||
        !targetProjectDirectory
      ) {
        return;
      }

      const persistedSetup = await loadPersistedSetupForDirectory(
        targetProjectDirectory,
      );
      if (!persistedSetup) {
        return;
      }

      activeSocket.send(
        JSON.stringify({
          type: 'configure_project',
          data: {
            templateId: persistedSetup.templateId,
            style: persistedSetup.style,
            duration: persistedSetup.duration,
            autonomousMode: Boolean(persistedSetup.autonomousMode),
            projectDir: targetProjectDirectory,
            projectName: getProjectNameFromDirectory(targetProjectDirectory),
          },
        }),
      );
    },
    [loadPersistedSetupForDirectory],
  );

  const flushSnapshotSave = useCallback(
    (targetProjectDirectory: string | null | undefined) => {
      if (snapshotSaveTimeoutRef.current) {
        clearTimeout(snapshotSaveTimeoutRef.current);
        snapshotSaveTimeoutRef.current = null;
      }
      if (!targetProjectDirectory) {
        return;
      }
      void persistSnapshot(targetProjectDirectory).catch((error) => {
        console.error('[ChatPanel] Failed to flush chat snapshot:', error);
      });
    },
    [persistSnapshot],
  );

  const persistOriginalInputIfNeeded = useCallback(
    async (content: string, optionsToIgnore: string[] = []): Promise<void> => {
      if (!projectDirectory) {
        return;
      }

      const normalizedContent = normalizeComparableChatText(content);
      if (!normalizedContent) {
        return;
      }

      if (
        optionsToIgnore.some(
          (option) => normalizeComparableChatText(option) === normalizedContent,
        )
      ) {
        return;
      }

      const inputPath = `${projectDirectory}/${ORIGINAL_INPUT_FILE}`;
      try {
        const existingContent =
          await window.electron.project.readFile(inputPath);
        if (existingContent && normalizeComparableChatText(existingContent)) {
          return;
        }

        await window.electron.project.writeFile(inputPath, content.trim());
      } catch (error) {
        console.warn('[ChatPanel] Failed to persist original input:', error);
      }
    },
    [projectDirectory],
  );

  const restoreSnapshot = useCallback(
    async (targetProjectDirectory: string) => {
      console.log('[ChatPanel] Starting chat snapshot restore:', {
        projectDirectory: targetProjectDirectory,
      });
      setChatRestoreState(targetProjectDirectory, 'restoring');

      const pendingStop = stopRequestRef.current;
      if (pendingStop) {
        clearTimeout(pendingStop.timeoutId);
        stopRequestRef.current = null;
        pendingStop.resolve(false);
      }

      const snapshot = await loadChatSnapshot(targetProjectDirectory);
      resetConversationRefs();
      if (!snapshot) {
        console.log('[ChatPanel] No chat snapshot found for project:', {
          projectDirectory: targetProjectDirectory,
        });
        sessionIdRef.current = null;
        setMessages([]);
        setSessionId(null);
        setAgentStatus('idle');
        setAgentName('Kshana');
        setStatusMessage('Ready');
        setCurrentPhase(undefined);
        setPhaseDisplayName(undefined);
        setHasUserSentMessage(false);
        setIsTaskRunning(false);
        setIsStopPending(false);
        setAutonomousModeEnabled(false);
        setNotificationBanner(null);
        setSessionTimer({
          visible: false,
          elapsedMs: 0,
          running: false,
          completed: false,
        });
        setChatRestoreState(targetProjectDirectory, 'missing');
        return;
      }

      console.log('[ChatPanel] Restored chat snapshot:', {
        projectDirectory: targetProjectDirectory,
        messageCount: snapshot.messages.length,
        sessionId: snapshot.sessionId,
      });

      setMessages(
        (snapshot.messages as ChatMessage[]).filter(
          (msg) => !(msg.type === 'greeting' && msg.role === 'system'),
        ),
      );

      const firstUserMessage = snapshot.messages.find(
        (message) =>
          message.role === 'user' &&
          message.type === 'message' &&
          normalizeComparableChatText(message.content),
      );
      if (firstUserMessage) {
        void persistOriginalInputIfNeeded(firstUserMessage.content);
      }

      sessionIdRef.current = snapshot.sessionId ?? null;
      setSessionId(snapshot.sessionId);
      setAgentStatus(resolveAgentStatus(snapshot.uiState.agentStatus));
      setAgentName(snapshot.uiState.agentName || 'Kshana');
      setStatusMessage(snapshot.uiState.statusMessage || 'Ready');
      setCurrentPhase(snapshot.uiState.currentPhase);
      setPhaseDisplayName(snapshot.uiState.phaseDisplayName);
      setHasUserSentMessage(Boolean(snapshot.uiState.hasUserSentMessage));
      setIsTaskRunning(Boolean(snapshot.uiState.isTaskRunning));
      setIsStopPending(false);
      setAutonomousModeEnabled(Boolean(snapshot.uiState.autonomousMode));
      setNotificationBanner(null);
      setSessionTimer({
        visible: false,
        elapsedMs: 0,
        running: false,
        completed: false,
      });
      setChatRestoreState(targetProjectDirectory, 'restored');
    },
    [
      persistOriginalInputIfNeeded,
      resetConversationRefs,
      resolveAgentStatus,
      setChatRestoreState,
    ],
  );

  const clearChat = useCallback(() => {
    const pendingStop = stopRequestRef.current;
    if (pendingStop) {
      clearTimeout(pendingStop.timeoutId);
      stopRequestRef.current = null;
      pendingStop.resolve(false);
    }

    setMessages([]);
    setSessionId(null);
    resetConversationRefs();
    setAgentStatus('idle');
    setAgentName('Kshana');
    setStatusMessage('Ready');
    setCurrentPhase(undefined);
    setPhaseDisplayName(undefined);
    setHasUserSentMessage(false);
    setIsTaskRunning(false);
    setIsStopPending(false);
    setAutonomousModeEnabled(false);
    setNotificationBanner(null);
    setSessionTimer({
      visible: false,
      elapsedMs: 0,
      running: false,
      completed: false,
    });
    scheduleSnapshotSave(projectDirectory);
  }, [projectDirectory, resetConversationRefs, scheduleSnapshotSave]);

  const deleteMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
  }, []);

  const appendAssistantChunk = useCallback(
    (content: string, type: string, author?: string) => {
      // Always process chunks - create message even with empty content to show thinking state
      const trimmedContent = content || '';

      // Streaming types that should accumulate in the same message
      const streamingTypes = [
        'text_chunk',
        'agent_text',
        'coordinator_response',
        'stream_chunk',
      ];
      const isStreamingType = streamingTypes.includes(type);
      // Normalize stream_chunk to agent_text for comparison
      const normalizedType = type === 'stream_chunk' ? 'agent_text' : type;

      lastFinalizedAssistantStreamTextRef.current = '';

      setMessages((prev) => {
        const hasToolCallAfterIndex = (messageIndex: number) =>
          messageIndex >= 0 &&
          prev.slice(messageIndex + 1).some((msg) => msg.type === 'tool_call');

        // If we're streaming and have an active message, ALWAYS append to it
        // This matches CLI behavior where chunks accumulate smoothly
        if (isStreamingType && lastAssistantIdRef.current) {
          const existingIndex = prev.findIndex(
            (msg) => msg.id === lastAssistantIdRef.current,
          );
          const existingMessage =
            existingIndex >= 0 ? prev[existingIndex] : undefined;

          if (
            existingMessage &&
            !hasToolCallAfterIndex(existingIndex) &&
            existingMessage.role === 'assistant' &&
            existingMessage.type !== 'tool_call' && // Don't append to tool calls
            (existingMessage.type === 'agent_text' ||
              existingMessage.type === 'stream_chunk' ||
              existingMessage.type === normalizedType)
          ) {
            setIsStreaming(true);
            // Append content to existing message (smooth accumulation like CLI)
            return prev.map((message) => {
              if (message.id === lastAssistantIdRef.current) {
                const newContent = `${message.content || ''}${trimmedContent}`;
                return {
                  ...message,
                  content: newContent,
                  type: normalizedType, // Update to normalized type
                  author: message.author || author || 'Kshana',
                  timestamp: Date.now(), // Update timestamp to show it's active
                };
              }
              return message;
            });
          }
        }

        // Check for duplicate content only for substantial chunks (not during active streaming)
        // This prevents duplicate messages when stream restarts
        // Note: We check if we're currently streaming by seeing if lastAssistantIdRef points to a message
        const currentlyStreaming =
          lastAssistantIdRef.current &&
          prev.some(
            (msg) =>
              msg.id === lastAssistantIdRef.current && msg.role === 'assistant',
          );

        if (trimmedContent.length > 50 && !currentlyStreaming) {
          const contentHash = trimmedContent.substring(0, 100);
          for (
            let i = prev.length - 1;
            i >= Math.max(0, prev.length - 3);
            i--
          ) {
            const msg = prev[i];
            if (
              msg.role === 'assistant' &&
              !hasToolCallAfterIndex(i) &&
              msg.content &&
              msg.type === normalizedType &&
              msg.content.substring(0, 100) === contentHash
            ) {
              // Found duplicate - reuse this message and start streaming into it
              lastAssistantIdRef.current = msg.id;
              setIsStreaming(isStreamingType);
              return prev.map((m) =>
                m.id === msg.id
                  ? {
                      ...m,
                      content: m.content + trimmedContent,
                      timestamp: Date.now(),
                    }
                  : m,
              );
            }
          }
        }

        // Check if we already have an empty assistant message we can reuse
        // But NOT if it's a tool call - tool calls should be separate
        const lastMessage = prev[prev.length - 1];
        if (
          lastMessage &&
          lastMessage.role === 'assistant' &&
          lastMessage.type !== 'tool_call' &&
          lastMessage.type !== 'agent_question' && // Don't reuse questions
          (lastMessage.type === normalizedType ||
            (isStreamingType &&
              (lastMessage.type === 'agent_text' ||
                lastMessage.type === 'stream_chunk'))) &&
          (!lastMessage.content || lastMessage.content.trim().length === 0)
        ) {
          // Reuse the empty message
          lastAssistantIdRef.current = lastMessage.id;
          setIsStreaming(isStreamingType);
          return prev.map((msg) =>
            msg.id === lastMessage.id
              ? {
                  ...msg,
                  content: trimmedContent,
                  type: normalizedType,
                  author: msg.author || author || 'Kshana',
                  timestamp: Date.now(),
                }
              : msg,
          );
        }

        // Skip creating a standalone bubble for single non-word characters (e.g. "." coordinator signals)
        const contentForNoiseCheck = (content || '').trim();
        if (
          contentForNoiseCheck.length === 1 &&
          !/\w/.test(contentForNoiseCheck)
        ) {
          return prev;
        }

        // If the very last message is a non-empty assistant text bubble from the same agent,
        // treat this new chunk as a continuation — append rather than create a new bubble.
        // This handles fragmented streaming where the backend sends multiple sessions for one response.
        const lastMessageForContinuation = prev[prev.length - 1];
        if (
          isStreamingType &&
          lastMessageForContinuation &&
          lastMessageForContinuation.role === 'assistant' &&
          lastMessageForContinuation.type !== 'tool_call' &&
          lastMessageForContinuation.type !== 'agent_question' &&
          (lastMessageForContinuation.type === 'agent_text' ||
            lastMessageForContinuation.type === 'agent_response') &&
          lastMessageForContinuation.content &&
          lastMessageForContinuation.content.trim().length > 0
        ) {
          lastAssistantIdRef.current = lastMessageForContinuation.id;
          setIsStreaming(true);
          return prev.map((msg) =>
            msg.id === lastMessageForContinuation.id
              ? {
                  ...msg,
                  content: `${msg.content}${trimmedContent}`,
                  timestamp: Date.now(),
                }
              : msg,
          );
        }

        // Create new message for new stream
        const id = makeId();
        lastAssistantIdRef.current = id;
        setIsStreaming(isStreamingType);
        return [
          ...prev,
          {
            id,
            role: 'assistant',
            type: normalizedType,
            content: trimmedContent,
            timestamp: Date.now(),
            author: author || 'Kshana',
          },
        ];
      });
    },
    [],
  );

  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'client_disconnect');
      } catch {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptRef.current = 0;
  }, []);

  const flushPendingOutboundActions = useCallback((socket?: WebSocket) => {
    const targetSocket = socket ?? wsRef.current;
    if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (pendingOutboundActionsRef.current.length > 0) {
      const payload = pendingOutboundActionsRef.current.shift();
      if (!payload) break;
      targetSocket.send(payload);
    }
  }, []);

  const queueOutboundAction = useCallback((payload: string) => {
    pendingOutboundActionsRef.current.push(payload);
    if (pendingOutboundActionsRef.current.length > OUTBOUND_ACTION_QUEUE_CAP) {
      pendingOutboundActionsRef.current =
        pendingOutboundActionsRef.current.slice(
          pendingOutboundActionsRef.current.length - OUTBOUND_ACTION_QUEUE_CAP,
        );
    }
  }, []);

  // Debounce status updates to prevent flicker
  const statusUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const debouncedSetStatus = useCallback(
    (status: AgentStatus, message: string) => {
      if (statusUpdateTimeoutRef.current) {
        clearTimeout(statusUpdateTimeoutRef.current);
      }
      statusUpdateTimeoutRef.current = setTimeout(() => {
        setAgentStatus(status);
        setStatusMessage(message);
      }, 100); // 100ms debounce
    },
    [],
  );

  const showNotificationBanner = useCallback(
    (message: string, level: NotificationBannerState['level']) => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
      setNotificationBanner({ message, level });
      notificationTimeoutRef.current = setTimeout(() => {
        setNotificationBanner(null);
        notificationTimeoutRef.current = null;
      }, NOTIFICATION_AUTO_CLEAR_MS);
    },
    [],
  );

  /**
   * Handle server payload from kshana-core WebSocket.
   * kshana-core messages have the format: { type, sessionId, timestamp, data: {...} }
   */
  const handleServerPayload = useCallback(
    (payload: Record<string, unknown>) => {
      // Extract data from kshana-core message format
      const data = (payload.data as Record<string, unknown>) ?? payload;
      const messageType = payload.type as string;
      const payloadSessionId =
        typeof payload.sessionId === 'string' ? payload.sessionId : null;

      if (payloadSessionId && payloadSessionId !== sessionIdRef.current) {
        console.log(
          '[ChatPanel] Updating active session from server payload:',
          {
            previousSessionId: sessionIdRef.current,
            nextSessionId: payloadSessionId,
            messageType,
          },
        );
        sessionIdRef.current = payloadSessionId;
        setSessionId(payloadSessionId);
      }

      // Extract optional agent name logic (if provided by backend)
      // Use functional update to avoid dependency on agentName
      setAgentName((prevAgentName) => {
        const currentAgentName =
          (data.agentName as string) ??
          (payload.agentName as string) ??
          prevAgentName;
        return currentAgentName;
      });

      const requestId =
        typeof payload.requestId === 'string' ? payload.requestId : '';
      const opId =
        typeof data.opId === 'string' && data.opId.trim()
          ? data.opId
          : requestId || undefined;

      const sendRequestResponse = (
        responseType: string,
        responseRequestId: string,
        responseData: Record<string, unknown>,
        errorMessage?: string,
      ) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || !responseRequestId) {
          return;
        }
        ws.send(
          JSON.stringify(
            errorMessage
              ? {
                  type: responseType,
                  requestId: responseRequestId,
                  error: errorMessage,
                  data: responseData,
                }
              : {
                  type: responseType,
                  requestId: responseRequestId,
                  data: responseData,
                },
          ),
        );
      };

      const getAgentFileOpMeta = () => {
        const projectRoot = currentProjectDirectoryRef.current;
        if (!projectRoot) return null;
        return {
          opId,
          source: 'agent_ws' as const,
          projectRoot,
        };
      };

      const rejectMissingProjectRoot = (
        responseType: string,
        responseRequestId: string,
      ) => {
        const reason =
          'No active project root is available for backend file operations.';
        sendRequestResponse(
          responseType,
          responseRequestId,
          { success: false },
          reason,
        );
        const now = Date.now();
        if (now - lastMissingProjectRootWarningAtRef.current > 2000) {
          lastMissingProjectRootWarningAtRef.current = now;
          console.warn('[ChatPanel] Rejected backend file operation:', reason);
        }
      };

      const getWirePath = (pathValue: unknown): string | null => {
        if (typeof pathValue !== 'string') return null;
        const trimmed = pathValue.trim();
        if (!trimmed) return null;
        if (isAbsoluteWirePath(trimmed)) return null;
        return trimmed;
      };

      const formatFileOpError = (error: unknown, fallback: string): string =>
        getRendererErrorMessage(error, fallback);

      const isNoEntryError = (
        error: unknown,
        errorMessage: string,
      ): boolean => {
        if (errorMessage.includes('[ENOENT]')) {
          return true;
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'ENOENT'
        ) {
          return true;
        }
        return false;
      };

      switch (messageType) {
        case 'status': {
          // kshana-core status: { status: 'connected' | 'ready' | 'busy' | 'completed' | 'error', message?: string, agentName?: string }
          const statusMsg =
            (data.message as string) ??
            (data.status as string) ??
            'Status update';
          const status = data.status as string;
          const agentNameFromStatus = (data.agentName as string) ?? agentName;
          const isCancelAck = isCancelAckStatus(status, statusMsg);

          // Update agent name if it changed
          if (agentNameFromStatus !== agentName) {
            setAgentName(agentNameFromStatus);
          }

          // Map status to agent status with debouncing
          switch (status) {
            case 'connected':
              setAgentStatus('idle');
              setStatusMessage('Connected');
              window.electron.logger.logStatusChange(
                'idle',
                agentNameFromStatus,
                'Connected',
              );
              break;
            case 'busy':
              // Update status only - don't create placeholder messages
              // Real agent text will come through stream_chunk messages
              debouncedSetStatus('thinking', statusMsg || 'Thinking...');
              setIsTaskRunning(true);
              window.electron.logger.logStatusChange(
                'thinking',
                agentNameFromStatus,
                statusMsg || 'Thinking...',
              );
              break;
            case 'ready':
              debouncedSetStatus(
                'waiting',
                statusMsg || 'Waiting for input...',
              );
              setIsTaskRunning(false);
              if (isConfiguringProjectSetupRef.current) {
                setIsConfiguringProjectSetup(false);
                setIsProjectSetupConfigured(true);
                setSetupPanelMode('hidden');
              }
              if (isCancelAck) {
                resolveStopRequest(true);
              }
              window.electron.logger.logStatusChange(
                'waiting',
                agentNameFromStatus,
                statusMsg || 'Waiting for input...',
              );
              break;
            case 'completed':
              debouncedSetStatus('completed', statusMsg || 'Task completed');
              setIsTaskRunning(false);
              if (isStopPendingRef.current) {
                resolveStopRequest(true);
              }
              window.electron.logger.logStatusChange(
                'completed',
                agentNameFromStatus,
                statusMsg || 'Task completed',
              );
              break;
            case 'error':
              debouncedSetStatus('error', statusMsg);
              setIsTaskRunning(false);
              if (isConfiguringProjectSetupRef.current) {
                setIsConfiguringProjectSetup(false);
                setSetupError(
                  statusMsg || 'Failed to configure project setup.',
                );
              }
              if (isStopPendingRef.current) {
                resolveStopRequest(false, statusMsg || 'Failed to stop task.');
              }
              window.electron.logger.logStatusChange(
                'error',
                agentNameFromStatus,
                statusMsg,
              );
              break;
            default:
              setStatusMessage(statusMsg);
              window.electron.logger.logStatusChange(
                status,
                agentNameFromStatus,
                statusMsg,
              );
          }
          break;
        }
        case 'progress': {
          // kshana-core progress: { iteration, maxIterations, status }
          const { iteration, maxIterations, status: progressStatus } = data;
          const percent = maxIterations
            ? Math.round(
                ((iteration as number) / (maxIterations as number)) * 100,
              )
            : 0;
          const details = [
            progressStatus ? `${progressStatus}` : null,
            percent ? `Progress: ${percent}%` : null,
          ]
            .filter(Boolean)
            .join(' · ');

          setStatusMessage(details || 'Processing...');
          break;
        }
        case 'stream_chunk': {
          // kshana-core stream_chunk:
          // - assistant streaming: { content, done, agentName? }
          // - tool streaming: { content, done, toolCallId?, toolName?, reset?, agentName? }
          const content = (data.content as string) ?? '';
          const done = (data.done as boolean) ?? false;
          const toolCallId =
            typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
          const toolName =
            typeof data.toolName === 'string' ? data.toolName : undefined;
          const reset = Boolean(data.reset);

          // Skip empty chunks
          if (!content && !done) {
            break;
          }

          if (toolCallId || toolName) {
            if (shouldStreamToToolCallCard(toolName)) {
              finalizeAssistantStream();

              const activeToolCall = findActiveToolCallEntry(
                activeToolCallsRef.current,
                toolCallId,
                toolName,
              );

              if (activeToolCall) {
                updateToolCallStreamingContent(
                  activeToolCall.entry.messageId,
                  content,
                  {
                    reset,
                  },
                );
              }

              if (done) {
                finalizeAssistantStream();
              }
            } else {
              // Keep stream text in assistant bubbles below the tool row — not in the tool card.
              if (reset) {
                finalizeAssistantStream();
              }
              // Preserve whitespace-only chunks for text-generating tools.
              // Markdown streams often split headings, list markers, spaces, and
              // blank lines into separate chunks; trimming here corrupts the live view.
              if (content.length > 0) {
                appendAssistantChunk(content, 'stream_chunk', agentName);
              }

              if (done) {
                if (lastAssistantIdRef.current) {
                  const activeAssistant = messagesRef.current.find(
                    (message) =>
                      message.id === lastAssistantIdRef.current &&
                      message.role === 'assistant',
                  );
                  const finalizedText = activeAssistant
                    ? `${activeAssistant.content}${content}`
                    : undefined;
                  finalizeAssistantStream(finalizedText);
                } else {
                  finalizeAssistantStream();
                }
              }
            }
            break;
          }

          // FILTER: Skip repetitive meta-commentary messages that make it look like a loop
          // But show warnings for blocked messages to help with debugging
          const skipPatterns = [
            /^I apologize for/i,
            /^I understand\.? I will now/i,
            /^I am (still )?stuck/i,
            /^I need to (create|transition)/i,
            /^Please manually/i,
          ];

          const trimmedContent = content.trim();
          const isBlockedMessage = /^I am blocked/i.test(trimmedContent);
          const shouldSkip = skipPatterns.some((pattern) =>
            pattern.test(trimmedContent),
          );

          // Show warning for blocked messages instead of hiding them completely
          if (isBlockedMessage && !done) {
            console.warn(
              '[ChatPanel] Agent loop detected - blocked message:',
              trimmedContent.substring(0, 100),
            );
            // Show a condensed warning message to user
            appendSystemMessage(
              '⚠️ Agent retrying phase transition (circuit breaker will activate if needed)...',
              'status',
            );
            // Still skip the actual blocked message text to avoid clutter
            break;
          }

          if (shouldSkip && !done) {
            console.log(
              '[ChatPanel] Skipping redundant thinking message:',
              trimmedContent.substring(0, 50),
            );
            break;
          }

          setAgentStatus('thinking'); // Agent is generating reasoning/thinking text

          // Create/update message with stream chunk content (thinking happens before tool calls)
          appendAssistantChunk(content, 'stream_chunk', agentName);

          if (done) {
            const activeAssistant = lastAssistantIdRef.current
              ? messagesRef.current.find(
                  (message) =>
                    message.id === lastAssistantIdRef.current &&
                    message.role === 'assistant',
                )
              : null;
            const finalizedText = activeAssistant
              ? `${activeAssistant.content}${content}`
              : content;
            finalizeAssistantStream(finalizedText);
          }
          break;
        }
        case 'stream_end': {
          finalizeAssistantStream();
          setAgentStatus('idle');
          break;
        }
        case 'tool_call': {
          // Server sends tool_call events: { toolName, toolCallId (empty), arguments, status, result?, error? }
          // Status: 'started' (from onToolCall) or 'completed'/'error' (from onToolResult)
          const toolName = (data.toolName as string) ?? 'tool';
          const toolStatus = (data.status as string) ?? 'started';
          const args = (data.arguments as Record<string, unknown>) ?? {};
          const { result } = data;
          const { error } = data;
          const toolCallId = (data.toolCallId as string) || '';

          if (toolStatus === 'completed' || toolStatus === 'error') {
            // Clean thinking/reasoning content from result if it exists
            let cleanedResult = result ?? error;
            const cleanThinkingTags = (text: string): string => {
              return text
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<think>[\s\S]*?<\/redacted_reasoning>/gi, '')
                .replace(/<think[\s\S]*?\/>/gi, '')
                .trim();
            };

            if (
              cleanedResult &&
              typeof cleanedResult === 'object' &&
              'content' in cleanedResult
            ) {
              const content = cleanedResult.content as string;
              const cleanedContent = cleanThinkingTags(content);
              cleanedResult = { ...cleanedResult, content: cleanedContent };
            } else if (typeof cleanedResult === 'string') {
              cleanedResult = cleanThinkingTags(cleanedResult);
            }

            const reconnectMessage = getRemoteFsReconnectMessage(
              typeof cleanedResult === 'string'
                ? cleanedResult
                : ((
                    cleanedResult as {
                      error?: unknown;
                      message?: unknown;
                    } | null
                  )?.error ??
                    (
                      cleanedResult as {
                        error?: unknown;
                        message?: unknown;
                      } | null
                    )?.message),
            );

            const now = Date.now();
            let duration = (data.duration as number) ?? 0;
            let activeKey: string | null = null;

            if (toolCallId) {
              activeKey = toolCallId;
            }

            let activeEntry = activeKey
              ? activeToolCallsRef.current.get(activeKey)
              : undefined;

            if (!activeEntry) {
              // Find the oldest active tool call for this toolName (FIFO)
              for (const [key, value] of activeToolCallsRef.current.entries()) {
                if (value.toolName === toolName) {
                  activeKey = key;
                  activeEntry = value;
                  break;
                }
              }
            }
            if (!duration && activeEntry) {
              duration = Math.max(0, now - activeEntry.startTime);
            }

            // Log tool completion
            window.electron.logger.logToolComplete(
              toolName,
              cleanedResult,
              duration,
              toolStatus === 'error',
            );

            // Update existing tool call message (if it exists), otherwise append
            lastAssistantIdRef.current = null;
            setIsStreaming(false);

            if (activeEntry) {
              activeToolCallsRef.current.delete(activeKey as string);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === activeEntry.messageId
                    ? {
                        ...msg,
                        meta: {
                          ...(msg.meta || {}),
                          toolCallId: toolCallId || activeKey,
                          toolName,
                          args,
                          status:
                            toolStatus === 'error' ? 'error' : 'completed',
                          result: cleanedResult,
                          duration,
                        },
                        timestamp: Date.now(),
                      }
                    : msg,
                ),
              );
            } else {
              appendMessage({
                role: 'system',
                type: 'tool_call',
                content: '',
                author: agentName,
                meta: {
                  toolCallId: toolCallId || makeId(),
                  toolName,
                  args,
                  status: toolStatus === 'error' ? 'error' : 'completed',
                  result: cleanedResult,
                  duration,
                },
              });
            }

            const hasActiveQuestion = messagesRef.current.some(
              (message) => message.type === 'agent_question',
            );
            const nextUiState = getPostToolUiState({
              toolStatus: toolStatus === 'error' ? 'error' : 'completed',
              currentAgentStatus: agentStatusRef.current,
              isTaskRunning: isTaskRunningRef.current,
              hasActiveQuestion,
              hasOtherActiveTools: activeToolCallsRef.current.size > 0,
              toolMessage:
                reconnectMessage ??
                (typeof cleanedResult === 'string' && cleanedResult.trim()
                  ? cleanedResult
                  : toolStatus === 'error'
                    ? `${toolName} failed`
                    : undefined),
            });
            if (nextUiState) {
              setAgentStatus(nextUiState.agentStatus);
              setStatusMessage(nextUiState.statusMessage);
              setIsTaskRunning(nextUiState.isTaskRunning);
            }
            if (reconnectMessage) {
              appendSystemMessage(reconnectMessage, 'error');
            }

            // For content-generation tools, also render the result as an assistant message
            // so it appears in the natural chat flow (tool card remains for reference)
            if (
              toolStatus === 'completed' &&
              cleanedResult &&
              typeof cleanedResult === 'object' &&
              'content' in cleanedResult &&
              typeof cleanedResult.content === 'string' &&
              cleanedResult.content.trim()
            ) {
              // Only render if this is a content-generation tool (not read/update/system tools)
              const isContentGenerationTool =
                toolName.includes('generate') ||
                toolName.includes('create_content') ||
                toolName.includes('write_content');

              if (isContentGenerationTool) {
                // Don't duplicate if we already streamed this exact content
                const resultContent = cleanedResult.content.trim();
                const alreadyStreamed = messagesRef.current.some(
                  (msg) =>
                    msg.role === 'assistant' &&
                    (msg.type === 'agent_text' ||
                      msg.type === 'stream_chunk') &&
                    normalizeComparableChatText(msg.content) ===
                      normalizeComparableChatText(resultContent),
                );

                if (!alreadyStreamed) {
                  appendMessage({
                    role: 'assistant',
                    type: 'agent_text',
                    content: resultContent,
                    author: agentName,
                  });
                }
              }
            }

            // Check for phase transitions in update_project results
            if (
              toolName === 'update_project' &&
              cleanedResult &&
              typeof cleanedResult === 'object'
            ) {
              const resultObj = cleanedResult as Record<string, unknown>;

              // Update current phase from any update_project result
              if (resultObj.current_phase) {
                setCurrentPhase(resultObj.current_phase as string);
              }
              if (resultObj.new_phase_name) {
                setPhaseDisplayName(resultObj.new_phase_name as string);
              }

              if (resultObj._phaseTransition) {
                const transition = resultObj._phaseTransition as {
                  fromPhase: string;
                  toPhase: string;
                  displayName?: string;
                };
                window.electron.logger.logPhaseTransition(
                  transition.fromPhase,
                  transition.toPhase,
                  true,
                  `Transitioned to ${transition.displayName || transition.toPhase}`,
                );
                // Update phase state
                setCurrentPhase(transition.toPhase);
                setPhaseDisplayName(
                  transition.displayName || transition.toPhase,
                );
              }
            }
          } else if (toolStatus === 'started') {
            finalizeAssistantStream();

            const now = Date.now();
            const sequence =
              (toolCallSequenceRef.current.get(toolName) ?? 0) + 1;
            toolCallSequenceRef.current.set(toolName, sequence);
            const fallbackKey = `${toolName}-${sequence}`;
            const key = toolCallId || fallbackKey;

            debouncedSetStatus('executing', `Running ${toolName}...`);
            window.electron.logger.logToolStart(toolName, args);
            window.electron.logger.logStatusChange(
              'executing',
              agentName,
              `Running ${toolName}...`,
            );

            const messageId = appendMessage({
              role: 'system',
              type: 'tool_call',
              content: '',
              author: agentName,
              meta: {
                toolCallId: toolCallId || key,
                toolName,
                args,
                status: 'executing',
                result: undefined,
                duration: undefined,
              },
            });

            activeToolCallsRef.current.set(key, {
              messageId,
              startTime: now,
              toolName,
            });
          }
          break;
        }
        case 'agent_response': {
          // kshana-core agent_response: { output, status }
          const output = (data.output as string) ?? '';
          const responseStatus = data.status as string;
          if (output) {
            const normalizedOutput = normalizeComparableChatText(output);

            // Log agent response
            window.electron.logger.logAgentText(output, agentName);

            // Replace last assistant message if it exists (could be agent_text or stream_chunk)
            // to avoid duplicates
            setMessages((prev) => {
              if (
                shouldSuppressAgentResponse({
                  output,
                  status: responseStatus,
                  lastFinalizedStreamText:
                    lastFinalizedAssistantStreamTextRef.current,
                  messages: prev,
                })
              ) {
                return prev;
              }

              // Find the last assistant message that's not a question or tool call
              let lastAssistantIdx = -1;
              for (let i = prev.length - 1; i >= 0; i--) {
                const msg = prev[i];
                if (
                  msg.role === 'assistant' &&
                  msg.type !== 'agent_question' &&
                  msg.type !== 'tool_call' &&
                  (msg.type === 'agent_text' ||
                    msg.type === 'stream_chunk' ||
                    msg.type === 'agent_response')
                ) {
                  lastAssistantIdx = i;
                  break;
                }
              }

              if (lastAssistantIdx >= 0) {
                // Update existing message in place — avoids a duplicate bubble
                return prev.map((msg, idx) =>
                  idx === lastAssistantIdx
                    ? {
                        ...msg,
                        type: 'agent_response',
                        content: output,
                        timestamp: Date.now(),
                        author: agentName,
                      }
                    : msg,
                );
              }

              // No recent assistant message at all — create one
              const id = makeId();
              lastAssistantIdRef.current = id;
              return [
                ...prev,
                {
                  id,
                  role: 'assistant',
                  type: 'agent_response',
                  content: output,
                  timestamp: Date.now(),
                  author: agentName,
                },
              ];
            });
            lastFinalizedAssistantStreamTextRef.current = normalizedOutput;
            lastAssistantIdRef.current = null;
            setIsStreaming(false);
          }

          if (responseStatus === 'completed') {
            setAgentStatus('completed');
            setStatusMessage('Completed');
            setIsTaskRunning(false);
            if (isStopPendingRef.current) {
              resolveStopRequest(true);
            }
            window.electron.logger.logStatusChange(
              'completed',
              agentName,
              'Completed',
            );
          } else if (responseStatus === 'cancelled') {
            setAgentStatus('waiting');
            setStatusMessage('Task cancelled');
            setIsTaskRunning(false);
            resolveStopRequest(true);
            window.electron.logger.logStatusChange(
              'waiting',
              agentName,
              'Task cancelled',
            );
          } else if (responseStatus === 'max_iterations') {
            setAgentStatus('error');
            setStatusMessage('Agent reached maximum iterations');
            setIsTaskRunning(false);
            if (isStopPendingRef.current) {
              resolveStopRequest(false, 'Agent reached maximum iterations.');
            }
            window.electron.logger.logStatusChange(
              'error',
              agentName,
              'Agent reached maximum iterations',
            );
            appendSystemMessage(
              'Agent reached maximum iterations before finishing. Try a narrower request or continue from current output.',
              'error',
            );
          } else if (responseStatus === 'error') {
            setAgentStatus('error');
            setStatusMessage('Error');
            setIsTaskRunning(false);
            if (isStopPendingRef.current) {
              resolveStopRequest(false, 'Failed to stop task.');
            }
            window.electron.logger.logStatusChange('error', agentName, 'Error');
            window.electron.logger.logError(
              'An error occurred while processing your request.',
            );
            appendSystemMessage(
              'An error occurred while processing your request.',
              'error',
            );
          }
          break;
        }
        case 'agent_question': {
          // kshana-core agent_question: { question, options?, timeout?, defaultOption?, questionType? }
          // options can be string[] or Array<{ label: string; description?: string }>
          const question = (data.question as string) ?? '';
          const rawOptions = data.options as
            | string[]
            | Array<{ label: string; description?: string }>
            | undefined;
          const options: ChatQuestionOption[] | undefined = rawOptions?.map(
            (option) =>
              typeof option === 'string'
                ? { label: option }
                : {
                    label: option.label,
                    description: option.description,
                  },
          );
          const isConfirmation = Boolean(data.isConfirmation);
          const questionType =
            (data.questionType as 'text' | 'confirm' | 'select' | undefined) ??
            (isConfirmation
              ? 'confirm'
              : options && options.length > 0
                ? 'select'
                : 'text');
          const autoApproveTimeoutMs =
            typeof data.autoApproveTimeoutMs === 'number'
              ? data.autoApproveTimeoutMs
              : typeof data.timeout === 'number'
                ? data.timeout * 1000
                : undefined;
          const defaultOption = (data.defaultOption as string) ?? undefined;
          const effectiveAutoResponse = getImmediateAutoQuestionResponse({
            options,
            questionType,
            isConfirmation,
            autoApproveTimeoutMs,
            defaultOption,
          });

          if (question) {
            // Log question
            const questionOptions = rawOptions
              ? rawOptions.map((opt) =>
                  typeof opt === 'string' ? { label: opt } : opt,
                )
              : undefined;
            window.electron.logger.logQuestion(
              question,
              questionOptions as
                | Array<{ label: string; description?: string }>
                | undefined,
              isConfirmation || questionType === 'confirm',
              autoApproveTimeoutMs,
            );

            // Update existing question message if it exists to avoid duplicates
            setMessages((prev) => {
              if (lastQuestionMessageIdRef.current) {
                const existingQuestion = prev.find(
                  (msg) => msg.id === lastQuestionMessageIdRef.current,
                );
                if (
                  existingQuestion &&
                  existingQuestion.type === 'agent_question'
                ) {
                  // Update existing question
                  return prev.map((msg) =>
                    msg.id === lastQuestionMessageIdRef.current
                      ? {
                          ...msg,
                          content: question,
                          meta: {
                            options,
                            questionType,
                            isConfirmation,
                            autoApproveTimeoutMs,
                            defaultOption,
                          },
                          timestamp: Date.now(),
                        }
                      : msg,
                  );
                }
              }

              // Check if the same question already exists
              const duplicateQuestion = prev.find(
                (msg) =>
                  msg.type === 'agent_question' && msg.content === question,
              );
              if (duplicateQuestion) {
                lastQuestionMessageIdRef.current = duplicateQuestion.id;
                return prev;
              }

              // Create new question message
              const id = makeId();
              lastQuestionMessageIdRef.current = id;
              return [
                ...prev,
                {
                  id,
                  role: 'assistant',
                  type: 'agent_question',
                  content: question,
                  author: agentName,
                  timestamp: Date.now(),
                  meta: {
                    options,
                    questionType,
                    isConfirmation,
                    autoApproveTimeoutMs,
                    defaultOption,
                  },
                },
              ];
            });

            lastAssistantIdRef.current = null;
            setIsStreaming(false);
            setIsTaskRunning(false);

            if (effectiveAutoResponse) {
              void persistOriginalInputIfNeeded(
                effectiveAutoResponse,
                (questionOptions || []).map((option) => option.label),
              ).catch((error) => {
                console.warn(
                  '[ChatPanel] Failed to persist auto-approved response:',
                  error,
                );
              });

              if (lastQuestionMessageIdRef.current) {
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === lastQuestionMessageIdRef.current
                      ? {
                          ...message,
                          meta: {
                            ...message.meta,
                            selectedResponse: effectiveAutoResponse,
                          },
                          timestamp: Date.now(),
                        }
                      : message,
                  ),
                );
              }

              window.electron.logger.logUserInput(effectiveAutoResponse);
              setHasUserSentMessage(true);
              awaitingResponseRef.current = false;
              setAgentStatus('thinking');
              setStatusMessage('Processing...');
              window.electron.logger.logStatusChange(
                'thinking',
                agentName,
                `Auto-approving question with: ${effectiveAutoResponse}`,
              );
              lastQuestionMessageIdRef.current = null;
              appendMessage({
                role: 'user',
                type: 'message',
                content: effectiveAutoResponse,
              });
              void sendClientActionRef.current({
                type: 'user_response',
                data: { response: effectiveAutoResponse },
              });
              break;
            }

            setAgentStatus('waiting');
            setStatusMessage('Waiting for your input');
            window.electron.logger.logStatusChange(
              'waiting',
              agentName,
              'Waiting for your input',
            );
            awaitingResponseRef.current = true;
          }
          break;
        }
        case 'todo_update': {
          // kshana-core todo_update: { todos }
          const todos = normalizeTodoUpdatePayload(
            (data.todos as Array<Record<string, unknown>> | undefined) ?? [],
          );

          window.electron.logger.logTodoUpdate(
            todos.map((todo) => ({
              content:
                (typeof todo.content === 'string' && todo.content) ||
                (typeof todo.id === 'string' ? todo.id : 'todo'),
              status: typeof todo.status === 'string' ? todo.status : 'pending',
            })),
          );

          if (lastTodoMessageIdRef.current) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === lastTodoMessageIdRef.current
                  ? {
                      ...msg,
                      meta: { ...msg.meta, todos },
                      timestamp: Date.now(),
                    }
                  : msg,
              ),
            );
          } else {
            const messageId = appendMessage({
              role: 'system',
              type: 'todo_update',
              content: '',
              meta: { todos },
            });
            lastTodoMessageIdRef.current = messageId;
          }
          break;
        }
        case 'background_generation': {
          const batchId = String(data.batchId ?? '');
          const kind = (data.kind as 'image' | 'video' | undefined) ?? 'image';
          const batchStatus =
            (data.status as
              | 'queued'
              | 'running'
              | 'completed'
              | 'failed'
              | undefined) ?? 'running';
          const totalItems = Number(data.totalItems ?? 0);
          const completedItems = Number(data.completedItems ?? 0);
          const failedItems = Number(data.failedItems ?? 0);
          const kindLabel = kind === 'video' ? 'video' : 'image';

          if (batchStatus === 'queued' || batchStatus === 'running') {
            const progress =
              totalItems > 0
                ? ` (${Math.min(completedItems, totalItems)}/${totalItems})`
                : '';
            setStatusMessage(
              `Background ${kindLabel} generation ${batchStatus}${progress}.`,
            );
            break;
          }

          const dedupeKey = `${batchId}:${batchStatus}`;
          if (backgroundGenerationEventDedupe.has(dedupeKey)) {
            break;
          }
          backgroundGenerationEventDedupe.add(dedupeKey);

          if (batchStatus === 'completed') {
            appendSystemMessage(
              `Background ${kindLabel} generation finished (${completedItems}/${totalItems}).`,
              'status',
            );
          } else if (batchStatus === 'failed') {
            appendSystemMessage(
              `Background ${kindLabel} generation finished with failures (${completedItems}/${totalItems}, failed: ${failedItems}).`,
              'status',
            );
          }
          break;
        }
        case 'notification': {
          const notificationMessage = (data.message as string) ?? '';
          if (!notificationMessage.trim()) {
            break;
          }

          showNotificationBanner(
            notificationMessage,
            normalizeNotificationLevel(data.level),
          );
          break;
        }
        case 'usage_fact': {
          // Usage facts are billed by the website proxy in cloud mode.
          // Desktop only acknowledges the event so it does not appear as unknown traffic.
          break;
        }
        case 'billing_update': {
          window.electron.account.refreshBalance().catch(() => null);
          break;
        }
        case 'session_timer': {
          setSessionTimer({
            visible: true,
            elapsedMs:
              typeof data.elapsedMs === 'number' &&
              Number.isFinite(data.elapsedMs)
                ? data.elapsedMs
                : 0,
            running: Boolean(data.running),
            completed: Boolean(data.completed),
          });
          break;
        }
        case 'error': {
          const errorMsg = (data.message as string) ?? 'An error occurred';
          const errorCode = (data.code as string) ?? '';
          const isUnsupportedProjectStateSync =
            errorCode === 'unknown_message_type' &&
            /project_state_sync/i.test(errorMsg);
          const isTransientNetworkError =
            errorCode === 'transient_network_error' ||
            /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|connection reset|network error|fetch failed/i.test(
              errorMsg,
            );

          if (isUnsupportedProjectStateSync) {
            supportsProjectStateSyncRef.current = false;
            console.warn(
              '[ChatPanel] Backend does not support project_state_sync; disabling snapshot sync.',
            );
            break;
          }

          if (errorCode === 'cancel_failed' && isStopPendingRef.current) {
            resolveStopRequest(false, errorMsg);
            break;
          }

          if (isTransientNetworkError) {
            const retryMessage =
              `Transient network issue while contacting the model: ${errorMsg}. ` +
              'Please retry your last step.';
            markExecutionInterrupted(
              'Connection issue. Ready to retry.',
              errorMsg,
              retryMessage,
            );
            window.electron.logger.logError(
              errorMsg,
              data as Record<string, unknown>,
            );
            window.electron.logger.logStatusChange(
              'waiting',
              agentName,
              'Connection issue. Ready to retry.',
            );
            break;
          }
          const reconnectMessage = getRemoteFsReconnectMessage(errorMsg);
          if (reconnectMessage) {
            appendSystemMessage(reconnectMessage, 'error');
          }
          appendSystemMessage(errorMsg, 'error');
          finalizeAssistantStream();
          failActiveToolCalls(errorMsg);
          setAgentStatus('error');
          setStatusMessage(errorMsg);
          setIsTaskRunning(false);
          setSessionTimer((prev) => ({
            ...prev,
            running: false,
          }));
          window.electron.logger.logError(
            errorMsg,
            data as Record<string, unknown>,
          );
          window.electron.logger.logStatusChange('error', agentName, errorMsg);
          break;
        }
        case 'remotion_render_request': {
          const request = data as Partial<RemotionServerRenderRequest>;
          const requestId =
            typeof request.requestId === 'string'
              ? request.requestId.trim()
              : '';
          if (!requestId) {
            console.warn(
              '[ChatPanel] remotion_render_request missing requestId',
              payload,
            );
            break;
          }

          const sendResult = (result: RemotionServerRenderResult) => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              return;
            }
            ws.send(
              JSON.stringify({
                type: 'remotion_render_result',
                data: result,
              }),
            );
          };

          if (!projectDirectory) {
            sendResult({
              requestId,
              status: 'failed',
              error:
                'No active project selected on desktop for Remotion rendering.',
            });
            break;
          }

          const requestedProjectDir =
            typeof request.projectDir === 'string'
              ? request.projectDir.trim()
              : '';
          const normalizeProjectPath = (value: string) =>
            value.replace(/\\/g, '/').replace(/\/+$/, '');
          if (
            requestedProjectDir &&
            normalizeProjectPath(requestedProjectDir) !==
              normalizeProjectPath(projectDirectory)
          ) {
            sendResult({
              requestId,
              status: 'failed',
              error:
                'Requested project directory does not match the active desktop project.',
            });
            break;
          }

          const requestPayload: RemotionServerRenderRequest = {
            requestId,
            projectDir: projectDirectory,
            placements: Array.isArray(request.placements)
              ? request.placements
              : [],
            components: Array.isArray(request.components)
              ? request.components
              : [],
            indexContent:
              typeof request.indexContent === 'string'
                ? request.indexContent
                : '',
            componentSource:
              request.componentSource &&
              typeof request.componentSource === 'object'
                ? request.componentSource
                : undefined,
          };

          void window.electron.remotion
            .renderFromServerRequest(
              projectDirectory,
              requestPayload,
              (progress: RemotionServerRenderProgress) => {
                const ws = wsRef.current;
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                  return;
                }
                ws.send(
                  JSON.stringify({
                    type: 'remotion_render_progress',
                    data: progress,
                  }),
                );
              },
            )
            .then((result) => {
              sendResult(result);
              if (result.status !== 'completed') {
                appendSystemMessage(
                  `Desktop Remotion render failed: ${result.error || 'Unknown error'}`,
                  'error',
                );
              }
            })
            .catch((error: unknown) => {
              const errorMessage = getRendererErrorMessage(
                error,
                'Desktop Remotion render failed.',
              );
              sendResult({
                requestId,
                status: 'failed',
                error: errorMessage,
              });
              appendSystemMessage(
                `Desktop Remotion render failed: ${errorMessage}`,
                'error',
              );
            });
          break;
        }
        case 'timeline_assembly_request': {
          const request = data as Partial<TimelineAssemblyRequest>;
          const requestId =
            typeof request.requestId === 'string'
              ? request.requestId.trim()
              : '';
          if (!requestId) {
            console.warn(
              '[ChatPanel] timeline_assembly_request missing requestId',
              payload,
            );
            break;
          }

          const sendProgress = (progress: TimelineAssemblyProgress) => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              return;
            }
            ws.send(
              JSON.stringify({
                type: 'timeline_assembly_progress',
                data: progress,
              }),
            );
          };

          const sendResult = (result: TimelineAssemblyResult) => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              return;
            }
            ws.send(
              JSON.stringify({
                type: 'timeline_assembly_result',
                data: result,
              }),
            );
          };

          if (!projectDirectory) {
            sendResult({
              requestId,
              status: 'failed',
              error:
                'No active project selected on desktop for timeline assembly.',
            });
            break;
          }

          const requestPayload: TimelineAssemblyRequest = {
            requestId,
            projectDir:
              typeof request.projectDir === 'string'
                ? request.projectDir
                : projectDirectory,
            timelineItems: Array.isArray(request.timelineItems)
              ? request.timelineItems
              : [],
            audioPath:
              typeof request.audioPath === 'string'
                ? request.audioPath
                : undefined,
            overlayItems: Array.isArray(request.overlayItems)
              ? request.overlayItems
              : undefined,
            textOverlayCues: Array.isArray(request.textOverlayCues)
              ? request.textOverlayCues
              : undefined,
            promptOverlayCues: Array.isArray(request.promptOverlayCues)
              ? request.promptOverlayCues
              : undefined,
            outputIntent: 'final_video',
            outputName:
              typeof request.outputName === 'string'
                ? request.outputName
                : 'final_video',
          };

          void assembleRemoteFinalVideo(
            projectDirectory,
            requestPayload,
            sendProgress,
          )
            .then((result) => {
              sendResult(result);
              if (result.status !== 'completed') {
                appendSystemMessage(
                  `Desktop final assembly failed: ${result.error || 'Unknown error'}`,
                  'error',
                );
              }
            })
            .catch((error: unknown) => {
              const errorMessage = getRendererErrorMessage(
                error,
                'Desktop final assembly failed.',
              );
              sendResult({
                requestId,
                status: 'failed',
                error: errorMessage,
              });
              appendSystemMessage(
                `Desktop final assembly failed: ${errorMessage}`,
                'error',
              );
            });
          break;
        }
        case 'file_read_request': {
          const requestedPath = getWirePath(data.path);
          if (!requestedPath) {
            const reason = 'Invalid or unsafe file path for file_read_request.';
            sendRequestResponse('file_read_response', requestId, {}, reason);
            appendSystemMessage(`⚠️ ${reason}`, 'error');
            break;
          }
          const fileOpMeta = getAgentFileOpMeta();
          if (!fileOpMeta) {
            rejectMissingProjectRoot('file_read_response', requestId);
            break;
          }
          void window.electron.project
            .readFileGuarded(requestedPath, fileOpMeta)
            .then((content) => {
              sendRequestResponse('file_read_response', requestId, { content });
            })
            .catch((error) => {
              const reason = formatFileOpError(
                error,
                'Failed to read file from desktop workspace.',
              );
              sendRequestResponse('file_read_response', requestId, {}, reason);
              appendSystemMessage(
                `⚠️ Failed to read file: ${pathBasename(requestedPath)}. ${reason}`,
                'error',
              );
            });
          break;
        }
        case 'file_list_request': {
          const requestedPath = getWirePath(data.path);
          if (!requestedPath) {
            const reason =
              'Invalid or unsafe directory path for file_list_request.';
            sendRequestResponse('file_list_response', requestId, {}, reason);
            appendSystemMessage(`⚠️ ${reason}`, 'error');
            break;
          }
          const fileOpMeta = getAgentFileOpMeta();
          if (!fileOpMeta) {
            rejectMissingProjectRoot('file_list_response', requestId);
            break;
          }
          void window.electron.project
            .listDirectory(requestedPath, fileOpMeta)
            .then((entries) => {
              sendRequestResponse('file_list_response', requestId, { entries });
            })
            .catch((error) => {
              const reason = formatFileOpError(
                error,
                'Failed to list directory from desktop workspace.',
              );
              sendRequestResponse('file_list_response', requestId, {}, reason);
              appendSystemMessage(
                `⚠️ Failed to list directory: ${pathBasename(requestedPath)}. ${reason}`,
                'error',
              );
            });
          break;
        }
        case 'file_exists_request': {
          const requestedPath = getWirePath(data.path);
          if (!requestedPath) {
            sendRequestResponse('file_exists_response', requestId, {
              exists: false,
            });
            break;
          }
          const fileOpMeta = getAgentFileOpMeta();
          if (!fileOpMeta) {
            rejectMissingProjectRoot('file_exists_response', requestId);
            break;
          }
          void window.electron.project
            .statPath(requestedPath, fileOpMeta)
            .then(() => {
              sendRequestResponse('file_exists_response', requestId, {
                exists: true,
              });
            })
            .catch((error) => {
              const reason = formatFileOpError(
                error,
                'Failed to check file existence.',
              );
              if (isNoEntryError(error, reason)) {
                sendRequestResponse('file_exists_response', requestId, {
                  exists: false,
                });
                return;
              }
              sendRequestResponse(
                'file_exists_response',
                requestId,
                {},
                reason,
              );
              appendSystemMessage(
                `⚠️ Failed to check path existence: ${pathBasename(requestedPath)}. ${reason}`,
                'error',
              );
            });
          break;
        }
        case 'file_stat_request': {
          const requestedPath = getWirePath(data.path);
          if (!requestedPath) {
            const reason = 'Invalid or unsafe path for file_stat_request.';
            sendRequestResponse('file_stat_response', requestId, {}, reason);
            appendSystemMessage(`⚠️ ${reason}`, 'error');
            break;
          }
          const fileOpMeta = getAgentFileOpMeta();
          if (!fileOpMeta) {
            rejectMissingProjectRoot('file_stat_response', requestId);
            break;
          }
          void window.electron.project
            .statPath(requestedPath, fileOpMeta)
            .then((stat) => {
              sendRequestResponse('file_stat_response', requestId, stat);
            })
            .catch((error) => {
              const reason = formatFileOpError(
                error,
                'Failed to stat path in desktop workspace.',
              );
              sendRequestResponse('file_stat_response', requestId, {}, reason);
              appendSystemMessage(
                `⚠️ Failed to stat path: ${pathBasename(requestedPath)}. ${reason}`,
                'error',
              );
            });
          break;
        }
        case 'file_read_buffer_request': {
          const requestedPath = getWirePath(data.path);
          if (!requestedPath) {
            const reason =
              'Invalid or unsafe file path for file_read_buffer_request.';
            sendRequestResponse('file_buffer_response', requestId, {}, reason);
            appendSystemMessage(`⚠️ ${reason}`, 'error');
            break;
          }
          const fileOpMeta = getAgentFileOpMeta();
          if (!fileOpMeta) {
            rejectMissingProjectRoot('file_buffer_response', requestId);
            break;
          }
          void window.electron.project
            .readFileBufferGuarded(requestedPath, fileOpMeta)
            .then((base64Data) => {
              sendRequestResponse('file_buffer_response', requestId, {
                data: base64Data,
              });
            })
            .catch((error) => {
              const reason = formatFileOpError(
                error,
                'Failed to read binary file from desktop workspace.',
              );
              sendRequestResponse(
                'file_buffer_response',
                requestId,
                {},
                reason,
              );
              appendSystemMessage(
                `⚠️ Failed to read binary file: ${pathBasename(requestedPath)}. ${reason}`,
                'error',
              );
            });
          break;
        }
        case 'file_write': {
          const filePath = extractIncomingFileOpPath(data);
          const fileWriteRequestId = requestId;
          const fileContent = data.content as string;
          if (!filePath) {
            appendSystemMessage(
              '⚠️ Failed to save file: missing file path in server payload.',
              'error',
            );
            if (fileWriteRequestId) {
              sendRequestResponse(
                'file_write_ack',
                fileWriteRequestId,
                { success: false },
                'Missing file path in file write payload.',
              );
            }
            break;
          }
          if (isAbsoluteWirePath(filePath)) {
            appendSystemMessage(
              `⚠️ Rejected unsafe absolute file path from server: ${filePath}`,
              'error',
            );
            if (fileWriteRequestId) {
              sendRequestResponse(
                'file_write_ack',
                fileWriteRequestId,
                { success: false },
                `Unsafe absolute file path rejected: ${filePath}`,
              );
            }
            break;
          }
          if (filePath && fileContent !== undefined) {
            const fileOpMeta = getAgentFileOpMeta();
            if (!fileOpMeta) {
              rejectMissingProjectRoot('file_write_ack', fileWriteRequestId);
              break;
            }
            window.electron.project
              .writeFile(filePath, fileContent, fileOpMeta)
              .then(() => {
                if (fileWriteRequestId) {
                  sendRequestResponse('file_write_ack', fileWriteRequestId, {
                    success: true,
                  });
                }
              })
              .catch((err) => {
                console.error('[ChatPanel] file_write failed:', filePath, err);
                const reason = formatFileOpError(
                  err,
                  'Unknown file write error.',
                );
                if (fileWriteRequestId) {
                  sendRequestResponse(
                    'file_write_ack',
                    fileWriteRequestId,
                    { success: false },
                    reason,
                  );
                }
                appendSystemMessage(
                  `⚠️ Failed to save file: ${pathBasename(filePath)}. ${reason}`,
                  'error',
                );
              });
          }
          break;
        }
        case 'file_write_command': {
          const commandPayload = {
            ...data,
            relativePath: data.path,
            content: data.content,
          };
          const syntheticPayload = {
            ...payload,
            type: 'file_write',
            data: commandPayload,
          };
          handleServerPayload(syntheticPayload as Record<string, unknown>);
          break;
        }
        case 'file_write_binary': {
          const binPath = extractIncomingFileOpPath(data);
          const fileWriteRequestId = requestId;
          const binContent = data.content as string;
          if (!binPath) {
            appendSystemMessage(
              '⚠️ Failed to save binary file: missing file path in server payload.',
              'error',
            );
            if (fileWriteRequestId) {
              sendRequestResponse(
                'file_write_ack',
                fileWriteRequestId,
                { success: false },
                'Missing file path in binary write payload.',
              );
            }
            break;
          }
          if (isAbsoluteWirePath(binPath)) {
            appendSystemMessage(
              `⚠️ Rejected unsafe absolute file path from server: ${binPath}`,
              'error',
            );
            if (fileWriteRequestId) {
              sendRequestResponse(
                'file_write_ack',
                fileWriteRequestId,
                { success: false },
                `Unsafe absolute file path rejected: ${binPath}`,
              );
            }
            break;
          }
          if (binPath && binContent) {
            const fileOpMeta = getAgentFileOpMeta();
            if (!fileOpMeta) {
              rejectMissingProjectRoot('file_write_ack', fileWriteRequestId);
              break;
            }
            window.electron.project
              .writeFileBinary(binPath, binContent, fileOpMeta)
              .then(() => {
                if (fileWriteRequestId) {
                  sendRequestResponse('file_write_ack', fileWriteRequestId, {
                    success: true,
                  });
                }
              })
              .catch((err) => {
                console.error(
                  '[ChatPanel] file_write_binary failed:',
                  binPath,
                  err,
                );
                const reason = formatFileOpError(
                  err,
                  'Unknown binary write error.',
                );
                if (fileWriteRequestId) {
                  sendRequestResponse(
                    'file_write_ack',
                    fileWriteRequestId,
                    { success: false },
                    reason,
                  );
                }
                appendSystemMessage(
                  `⚠️ Failed to save binary file: ${pathBasename(binPath)}. ${reason}`,
                  'error',
                );
              });
          }
          break;
        }
        case 'file_write_buffer_command': {
          const commandPayload = {
            ...data,
            relativePath: data.path,
            content: data.data,
          };
          const syntheticPayload = {
            ...payload,
            type: 'file_write_binary',
            data: commandPayload,
          };
          handleServerPayload(syntheticPayload as Record<string, unknown>);
          break;
        }
        case 'file_mkdir': {
          const mkdirPath = extractIncomingFileOpPath(data);
          const mkdirRequestId = requestId;
          if (!mkdirPath) {
            appendSystemMessage(
              '⚠️ Failed to create directory: missing path in server payload.',
              'error',
            );
            if (mkdirRequestId) {
              sendRequestResponse(
                'file_write_ack',
                mkdirRequestId,
                { success: false },
                'Missing directory path in mkdir payload.',
              );
            }
            break;
          }
          if (isAbsoluteWirePath(mkdirPath)) {
            appendSystemMessage(
              `⚠️ Rejected unsafe absolute directory path from server: ${mkdirPath}`,
              'error',
            );
            if (mkdirRequestId) {
              sendRequestResponse(
                'file_write_ack',
                mkdirRequestId,
                { success: false },
                `Unsafe absolute directory path rejected: ${mkdirPath}`,
              );
            }
            break;
          }
          if (mkdirPath) {
            const fileOpMeta = getAgentFileOpMeta();
            if (!fileOpMeta) {
              rejectMissingProjectRoot('file_write_ack', mkdirRequestId);
              break;
            }
            window.electron.project
              .mkdir(mkdirPath, fileOpMeta)
              .then(() => {
                if (mkdirRequestId) {
                  sendRequestResponse('file_write_ack', mkdirRequestId, {
                    success: true,
                  });
                }
              })
              .catch((err) => {
                console.error('[ChatPanel] file_mkdir failed:', mkdirPath, err);
                const reason = formatFileOpError(err, 'Unknown mkdir error.');
                if (mkdirRequestId) {
                  sendRequestResponse(
                    'file_write_ack',
                    mkdirRequestId,
                    { success: false },
                    reason,
                  );
                }
                appendSystemMessage(
                  `⚠️ Failed to create directory: ${pathBasename(mkdirPath)}. ${reason}`,
                  'error',
                );
              });
          }
          break;
        }
        case 'file_mkdir_command': {
          const commandPayload = {
            ...data,
            relativePath: data.path,
          };
          const syntheticPayload = {
            ...payload,
            type: 'file_mkdir',
            data: commandPayload,
          };
          handleServerPayload(syntheticPayload as Record<string, unknown>);
          break;
        }
        case 'file_rm': {
          const rmPath = extractIncomingFileOpPath(data);
          const rmRequestId = requestId;
          if (!rmPath) {
            appendSystemMessage(
              '⚠️ Failed to delete path: missing path in server payload.',
              'error',
            );
            if (rmRequestId) {
              sendRequestResponse(
                'file_write_ack',
                rmRequestId,
                { success: false },
                'Missing path in delete payload.',
              );
            }
            break;
          }
          if (isAbsoluteWirePath(rmPath)) {
            appendSystemMessage(
              `⚠️ Rejected unsafe absolute delete path from server: ${rmPath}`,
              'error',
            );
            if (rmRequestId) {
              sendRequestResponse(
                'file_write_ack',
                rmRequestId,
                { success: false },
                `Unsafe absolute delete path rejected: ${rmPath}`,
              );
            }
            break;
          }
          if (rmPath) {
            const fileOpMeta = getAgentFileOpMeta();
            if (!fileOpMeta) {
              rejectMissingProjectRoot('file_write_ack', rmRequestId);
              break;
            }
            window.electron.project
              .delete(rmPath, fileOpMeta)
              .then(() => {
                if (rmRequestId) {
                  sendRequestResponse('file_write_ack', rmRequestId, {
                    success: true,
                  });
                }
              })
              .catch((err) => {
                console.error('[ChatPanel] file_rm failed:', rmPath, err);
                const reason = formatFileOpError(err, 'Unknown delete error.');
                if (rmRequestId) {
                  sendRequestResponse(
                    'file_write_ack',
                    rmRequestId,
                    { success: false },
                    reason,
                  );
                }
                appendSystemMessage(
                  `⚠️ Failed to delete path: ${pathBasename(rmPath)}. ${reason}`,
                  'error',
                );
              });
          }
          break;
        }
        case 'file_delete_command':
        case 'file_delete_dir_command': {
          const commandPayload = {
            ...data,
            relativePath: data.path,
          };
          const syntheticPayload = {
            ...payload,
            type: 'file_rm',
            data: commandPayload,
          };
          handleServerPayload(syntheticPayload as Record<string, unknown>);
          break;
        }
        case 'file_copy_command': {
          const sourcePath = getWirePath(data.src);
          const destinationPath = getWirePath(data.dest);
          if (!sourcePath || !destinationPath) {
            const reason = 'Invalid source or destination path for file copy.';
            sendRequestResponse(
              'file_write_ack',
              requestId,
              { success: false },
              reason,
            );
            appendSystemMessage(`⚠️ ${reason}`, 'error');
            break;
          }
          void window.electron.project
            .copyFileExact(sourcePath, destinationPath, {
              opId,
              source: 'agent_ws',
            })
            .then(() => {
              sendRequestResponse('file_write_ack', requestId, {
                success: true,
              });
            })
            .catch((error) => {
              const reason = formatFileOpError(
                error,
                'Failed to copy file in desktop workspace.',
              );
              sendRequestResponse(
                'file_write_ack',
                requestId,
                { success: false },
                reason,
              );
              appendSystemMessage(
                `⚠️ Failed to copy file: ${pathBasename(sourcePath)}. ${reason}`,
                'error',
              );
            });
          break;
        }
        case 'batch_write_command': {
          const operations = Array.isArray(data.operations)
            ? data.operations
            : [];
          if (operations.length === 0) {
            sendRequestResponse('file_write_ack', requestId, { success: true });
            break;
          }
          void (async () => {
            try {
              for (const operation of operations) {
                const op = operation as Record<string, unknown>;
                const opPath = getWirePath(op.path);
                const opContent =
                  typeof op.content === 'string' ? op.content : '';
                if (!opPath) {
                  throw new Error(
                    'Invalid path in batch_write_command operation.',
                  );
                }
                // eslint-disable-next-line no-await-in-loop
                const fileOpMeta = getAgentFileOpMeta();
                if (!fileOpMeta) {
                  throw new Error(
                    'No active project root is available for backend file operations.',
                  );
                }
                await window.electron.project.writeFile(
                  opPath,
                  opContent,
                  fileOpMeta,
                );
              }
              sendRequestResponse('file_write_ack', requestId, {
                success: true,
              });
            } catch (error) {
              const reason = formatFileOpError(
                error,
                'Failed to apply batch file writes in desktop workspace.',
              );
              sendRequestResponse(
                'file_write_ack',
                requestId,
                { success: false },
                reason,
              );
              appendSystemMessage(`⚠️ ${reason}`, 'error');
            }
          })();
          break;
        }
        default:
          console.warn(
            '[ChatPanel] Unhandled message type:',
            messageType,
            payload,
          );
          break;
      }
    },
    [
      appendAssistantChunk,
      appendMessage,
      appendSystemMessage,
      debouncedSetStatus,
      fetchSessionInfo,
      finalizeAssistantStream,
      getRendererErrorMessage,
      hasQueuedOutboundActionType,
      projectDirectory,
      removeQueuedOutboundActionType,
      resolveStopRequest,
      markExecutionInterrupted,
      showNotificationBanner,
      syncConfiguredProject,
      syncProjectState,
    ],
  );

  const connectWebSocket = useCallback(async (): Promise<WebSocket> => {
    // Prevent duplicate connections
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return wsRef.current;
    }

    // Prevent concurrent connection attempts
    if (connectingRef.current) {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            resolve(wsRef.current);
          } else if (!connectingRef.current) {
            clearInterval(checkInterval);
            reject(new Error('Connection attempt failed'));
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('Connection timeout'));
        }, 10000);
      });
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    connectingRef.current = true;
    setConnectionState('connecting');

    const scheduleReconnect = () => {
      if (reconnectTimeoutRef.current) {
        return;
      }

      const attempt = reconnectAttemptRef.current;
      const baseDelay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** attempt,
        RECONNECT_MAX_DELAY_MS,
      );
      const jitter = Math.floor(Math.random() * Math.max(250, baseDelay * 0.3));
      const delay = baseDelay + jitter;
      reconnectAttemptRef.current += 1;

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connectWebSocket().catch((error) => {
          appendConnectionBanner(
            'reconnect_failed',
            `Reconnection failed: ${(error as Error).message}. Retrying...`,
          );
          scheduleReconnect();
        });
      }, delay);
    };

    try {
      const effectiveSettings =
        appSettingsRef.current ??
        (await window.electron.settings.get().catch(() => null));
      if (!appSettingsRef.current && effectiveSettings) {
        appSettingsRef.current = effectiveSettings;
      }

      const currentState = await getBackendStateForSettings(effectiveSettings);
      if (currentState.status !== 'ready') {
        const errorMsg = currentState.message
          ? `Backend not ready: ${currentState.message}`
          : `Backend not ready (status: ${currentState.status})`;
        throw new Error(errorMsg);
      }

      const baseUrl = await getBackendBaseUrlForSettings(
        effectiveSettings,
        currentState,
      );
      const wsBase = baseUrl.replace(/^http/, 'ws');
      const url = new URL(DEFAULT_WS_PATH, wsBase);
      url.searchParams.set('channel', 'chat');
      url.searchParams.set('mode', 'remote');
      const getDesktopVersion = window.electron.app?.getVersion;
      const desktopVersion = getDesktopVersion
        ? await getDesktopVersion().catch(() => null)
        : null;
      applyDesktopRemotionQueryParams(url, desktopVersion);
      const comfyUIUrl = resolveComfyUIOverride(effectiveSettings);
      if (comfyUIUrl) {
        url.searchParams.set('comfyui_url', comfyUIUrl);
      }

      console.log('[ChatPanel] Connecting to WebSocket:', {
        projectDirectory,
        hasProjectDir: !!projectDirectory,
        serverUrl: baseUrl,
        desktopVersion,
        comfyuiMode: effectiveSettings?.comfyuiMode ?? 'inherit',
        hasComfyUIUrl: !!comfyUIUrl,
      });

      if (projectDirectory) {
        url.searchParams.set('project_dir', projectDirectory);
        console.log(
          '[ChatPanel] Set project_dir query param:',
          projectDirectory,
        );
      } else {
        console.warn(
          '[ChatPanel] No projectDirectory available - files may not be saved correctly',
        );
      }

      if (sessionIdRef.current) {
        url.searchParams.set('sessionId', sessionIdRef.current);
      }

      console.log('[ChatPanel] Final WebSocket URL:', url.toString());

      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(url.toString());
        wsRef.current = socket;

        const timeout = setTimeout(() => {
          if (socket.readyState !== WebSocket.OPEN) {
            socket.close();
            connectingRef.current = false;
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

        socket.onopen = () => {
          clearTimeout(timeout);
          connectingRef.current = false;
          setConnectionState('connected');
          reconnectAttemptRef.current = 0;
          connectionBannerRef.current = null;
          // Clear connection error messages on successful connect
          setMessages((prev) =>
            prev.filter(
              (msg) =>
                !(
                  msg.role === 'system' &&
                  msg.type === 'error' &&
                  (msg.content?.includes('Connection to backend lost') ||
                    msg.content?.includes('Chat connection interrupted') ||
                    msg.content?.includes('WebSocket connection error') ||
                    msg.content?.includes('Reconnection failed'))
                ),
            ),
          );
          const requestedSessionId = sessionIdRef.current;
          const hasQueuedConfigureProject =
            hasQueuedOutboundActionType('configure_project');
          void (async () => {
            const resumedSession = requestedSessionId
              ? await fetchSessionInfo(requestedSessionId, currentState)
              : null;
            console.log('[ChatPanel] WebSocket connected session sync state:', {
              requestedSessionId,
              resumedSessionId: resumedSession?.id ?? null,
              resumed: Boolean(resumedSession),
            });
            if (requestedSessionId && !resumedSession) {
              console.log(
                '[ChatPanel] Previous backend session is unavailable; preserving restored local chat history and attaching to a new session.',
                { requestedSessionId },
              );
            }
            await syncProjectState(socket, projectDirectory);
            if (resumedSession) {
              removeQueuedOutboundActionType('configure_project');
            }
            flushPendingOutboundActions(socket);
            if (
              shouldConfigureProjectAfterConnect(
                resumedSession,
                hasQueuedConfigureProject,
              )
            ) {
              await syncConfiguredProject(socket, projectDirectory);
            }
            if (resumedSession) {
              const resumedState = getResumedSessionUiState(resumedSession);
              setAgentStatus(resumedState.agentStatus);
              setStatusMessage(resumedState.statusMessage);
              setIsTaskRunning(resumedState.isTaskRunning);
              setAutonomousModeEnabled(resumedState.autonomousMode);
              setSessionTimer({
                visible:
                  typeof resumedSession.elapsedMs === 'number' &&
                  Number.isFinite(resumedSession.elapsedMs),
                elapsedMs:
                  typeof resumedSession.elapsedMs === 'number' &&
                  Number.isFinite(resumedSession.elapsedMs)
                    ? resumedSession.elapsedMs
                    : 0,
                running: resumedSession.status === 'running',
                completed: Boolean(resumedSession.completed),
              });
              if (resumedState.notice) {
                appendSystemMessage(resumedState.notice, 'status');
              }
              window.electron.logger.logStatusChange(
                resumedState.agentStatus,
                agentNameRef.current,
                resumedState.statusMessage,
              );
            }
            resolve(socket);
          })().catch((error) => {
            console.warn(
              '[ChatPanel] WebSocket post-connect sync failed:',
              error,
            );
            flushPendingOutboundActions(socket);
            resolve(socket);
          });
        };

        socket.onerror = (error) => {
          clearTimeout(timeout);
          connectingRef.current = false;
          console.error('[ChatPanel] WebSocket error:', error);
          if (isTaskRunningRef.current || isStopPendingRef.current) {
            markExecutionInterrupted(
              'Connection lost. Reconnecting...',
              'Execution interrupted because the chat connection dropped.',
            );
          }
          appendConnectionBanner(
            'ws_connection_error',
            'WebSocket connection error. Check if backend is running.',
          );
          reject(new Error('WebSocket connection error'));
        };

        socket.onclose = (event) => {
          clearTimeout(timeout);
          connectingRef.current = false;
          setConnectionState('disconnected');
          if (wsRef.current === socket) {
            wsRef.current = null;
          }
          if (event.code !== 1000) {
            void (async () => {
              let backendState: BackendState | null = null;
              try {
                backendState = await window.electron.backend.getState();
              } catch (error) {
                console.warn(
                  '[ChatPanel] Failed to read backend state after socket close:',
                  error,
                );
              }

              window.electron.logger.logError(
                'Chat WebSocket closed unexpectedly.',
                {
                  code: event.code,
                  reason: event.reason,
                  wasClean: event.wasClean,
                  backendState,
                },
              );
              if (isTaskRunningRef.current || isStopPendingRef.current) {
                markExecutionInterrupted(
                  'Connection lost. Reconnecting...',
                  'Execution interrupted because the backend connection closed.',
                );
              }
              appendConnectionBanner(
                'ws_disconnected',
                getDisconnectBannerMessage(backendState),
              );
              scheduleReconnect();
            })();
          }
        };

        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            handleServerPayload(payload);
          } catch (error) {
            console.error('[ChatPanel] Error parsing message:', error);
          }
        };
      });
    } catch (error) {
      connectingRef.current = false;
      setConnectionState('disconnected');
      throw error;
    }
  }, [
    appendSystemMessage,
    appendConnectionBanner,
    fetchSessionInfo,
    flushPendingOutboundActions,
    handleServerPayload,
    hasQueuedOutboundActionType,
    markExecutionInterrupted,
    projectDirectory,
    removeQueuedOutboundActionType,
    syncConfiguredProject,
    syncProjectState,
  ]);

  useEffect(() => {
    let active = true;

    const syncSettings = (
      next: AppSettings | null,
      allowReconnect: boolean,
    ) => {
      if (!active) {
        return;
      }

      appSettingsRef.current = next;

      const nextKey = getComfyUISettingsKey(next);
      const previousKey = comfyUISettingsKeyRef.current;
      comfyUISettingsKeyRef.current = nextKey;

      if (!allowReconnect || !previousKey || previousKey === nextKey) {
        return;
      }

      const hasActiveConnection = Boolean(
        wsRef.current && wsRef.current.readyState === WebSocket.OPEN,
      );
      if (!hasActiveConnection) {
        return;
      }

      if (settingsReconnectTimeoutRef.current) {
        clearTimeout(settingsReconnectTimeoutRef.current);
      }
      settingsReconnectTimeoutRef.current = setTimeout(() => {
        settingsReconnectTimeoutRef.current = null;
        appendSystemMessage(
          'ComfyUI settings changed. Reconnecting chat session to apply update...',
          'status',
        );
        disconnectWebSocket();
        connectWebSocket().catch((error) => {
          appendConnectionBanner(
            'comfyui_settings_reconnect_failed',
            `Failed to reconnect after ComfyUI settings update: ${(error as Error).message}`,
          );
        });
      }, SETTINGS_RECONNECT_DEBOUNCE_MS);
    };

    window.electron.settings
      .get()
      .then((stored) => {
        syncSettings(stored, false);
      })
      .catch(() => {
        syncSettings(null, false);
      });

    const unsubscribe = window.electron.settings.onChange((next) => {
      syncSettings(next, true);
    });

    return () => {
      active = false;
      unsubscribe();
      if (settingsReconnectTimeoutRef.current) {
        clearTimeout(settingsReconnectTimeoutRef.current);
      }
    };
  }, [
    appendConnectionBanner,
    appendSystemMessage,
    connectWebSocket,
    disconnectWebSocket,
  ]);

  const sendClientAction = useCallback(
    async (message: Record<string, unknown>) => {
      const serializedMessage = JSON.stringify(message);
      const activeSocket = wsRef.current;

      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.send(serializedMessage);
        return;
      }

      queueOutboundAction(serializedMessage);
      try {
        const socket = await connectWebSocket();
        flushPendingOutboundActions(socket);
      } catch (error) {
        console.warn(
          '[ChatPanel] Queued outbound action while reconnecting:',
          (error as Error).message,
        );
      }
    },
    [connectWebSocket, flushPendingOutboundActions, queueOutboundAction],
  );

  useEffect(() => {
    sendClientActionRef.current = sendClientAction;
  }, [sendClientAction]);

  const handleToggleAutonomousMode = useCallback(async () => {
    const nextEnabled = !autonomousModeEnabled;
    setAutonomousModeEnabled(nextEnabled);

    if (!sessionIdRef.current) {
      return;
    }

    await sendClientAction({
      type: 'set_autonomous',
      sessionId: sessionIdRef.current,
      data: { enabled: nextEnabled },
    });
    showNotificationBanner(
      `Autonomous mode ${nextEnabled ? 'enabled' : 'disabled'}.`,
      'info',
    );
  }, [autonomousModeEnabled, sendClientAction, showNotificationBanner]);

  const sendResponse = useCallback(
    async (content: string) => {
      const questionOptions = lastQuestionMessageIdRef.current
        ? (
            (messagesRef.current.find(
              (message) => message.id === lastQuestionMessageIdRef.current,
            )?.meta?.options as ChatQuestionOption[] | undefined) || []
          ).map((option) => option.label)
        : [];

      if (lastQuestionMessageIdRef.current) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === lastQuestionMessageIdRef.current
              ? {
                  ...message,
                  meta: {
                    ...message.meta,
                    selectedResponse: content,
                  },
                  timestamp: Date.now(),
                }
              : message,
          ),
        );
      }

      // Used for clicking options in QuestionPrompt
      window.electron.logger.logUserInput(content);

      // Mark that user has sent their first message
      setHasUserSentMessage(true);

      await persistOriginalInputIfNeeded(content, questionOptions);

      await sendClientAction({
        type: 'user_response',
        data: { response: content },
      });
      awaitingResponseRef.current = false;
      setAgentStatus('thinking');
      setStatusMessage('Processing...');

      // Clear question ref since we've responded
      lastQuestionMessageIdRef.current = null;

      // Also append user message for visual feedback
      appendMessage({
        role: 'user',
        type: 'message',
        content,
      });
    },
    [appendMessage, persistOriginalInputIfNeeded, sendClientAction],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!awaitingResponseRef.current) {
        if (isConfiguringProjectSetupRef.current) {
          appendSystemMessage(
            'Project setup is still being configured. Please wait a moment.',
            'status',
          );
          return;
        }
        if (projectDirectory && !isProjectSetupConfigured) {
          if (setupPanelMode !== 'wizard') {
            void openSetupWizard();
            appendSystemMessage(
              'Complete Project Setup before sending your first prompt.',
              'status',
            );
            return;
          }
          appendSystemMessage(
            'Complete Project Setup before sending your first prompt.',
            'status',
          );
          return;
        }
      }

      // Log user input
      window.electron.logger.logUserInput(content);

      // Mark that user has sent their first message
      setHasUserSentMessage(true);
      setIsTaskRunning(true);

      await persistOriginalInputIfNeeded(content);

      appendMessage({
        role: 'user',
        type: 'message',
        content,
      });

      setAgentStatus('thinking');
      setStatusMessage('Processing...');
      window.electron.logger.logStatusChange(
        'thinking',
        agentName,
        'Processing...',
      );

      if (awaitingResponseRef.current) {
        await sendClientAction({
          type: 'user_response',
          data: { response: content },
        });
        awaitingResponseRef.current = false;
      } else {
        await sendClientAction({
          type: 'start_task',
          data: { task: content },
        });
      }
    },
    [
      appendMessage,
      sendClientAction,
      agentName,
      appendSystemMessage,
      isProjectSetupConfigured,
      openSetupWizard,
      projectDirectory,
      persistOriginalInputIfNeeded,
      setupPanelMode,
    ],
  );

  const requestStop = useCallback(
    async (reason: 'user_stop' | 'project_switch'): Promise<boolean> => {
      const existingRequest = stopRequestRef.current;
      if (existingRequest) {
        return existingRequest.promise;
      }

      if (!isTaskRunningRef.current) {
        return true;
      }

      let resolveStop: ((success: boolean) => void) | null = null;
      const promise = new Promise<boolean>((resolve) => {
        resolveStop = resolve;
      });

      if (!resolveStop) {
        return false;
      }

      const timeoutId = setTimeout(() => {
        resolveStopRequest(
          false,
          'Stop request timed out. Task may still be running.',
        );
      }, STOP_ACK_TIMEOUT_MS);

      stopRequestRef.current = {
        promise,
        resolve: resolveStop,
        timeoutId,
      };

      setIsStopPending(true);
      setStatusMessage('Stopping...');

      await sendClientAction({
        type: 'cancel',
        data: { reason },
      });

      return promise;
    },
    [resolveStopRequest, sendClientAction],
  );

  const stopTask = useCallback(async () => {
    await requestStop('user_stop');
  }, [requestStop]);

  useEffect(() => {
    return registerProjectSwitchGuard(async ({ fromProjectDirectory }) => {
      if (!isTaskRunningRef.current && !isStopPendingRef.current) {
        return true;
      }

      const shouldSwitch = window.confirm(
        'Switching project will stop the current task. Continue?',
      );
      if (!shouldSwitch) {
        return false;
      }

      const stopped = await requestStop('project_switch');
      if (!stopped) {
        return false;
      }

      failActiveToolCalls('Cancelled due to project switch');
      flushSnapshotSave(fromProjectDirectory);
      return true;
    });
  }, [
    failActiveToolCalls,
    flushSnapshotSave,
    registerProjectSwitchGuard,
    requestStop,
  ]);

  // Register sendMessage so other components can trigger agent tasks (e.g. Render Infographics)
  useEffect(() => {
    if (agentContext?.registerSendTask) {
      return agentContext.registerSendTask(sendMessage);
    }
  }, [agentContext?.registerSendTask, sendMessage]);

  useEffect(() => {
    scheduleSnapshotSave(projectDirectory);
  }, [
    projectDirectory,
    messages,
    agentStatus,
    agentName,
    statusMessage,
    currentPhase,
    phaseDisplayName,
    hasUserSentMessage,
    isTaskRunning,
    sessionId,
    scheduleSnapshotSave,
  ]);

  useEffect(() => {
    const bootstrap = async () => {
      if (
        !shouldAutoConnectChat({
          projectDirectory,
          restoreState: getChatRestoreState(),
        })
      ) {
        return;
      }
      const state = await window.electron.backend.getState();
      if (
        state.status === 'ready' &&
        !wsRef.current &&
        !connectingRef.current &&
        !!projectDirectory
      ) {
        connectWebSocket().catch(() => undefined);
      }
    };
    bootstrap().catch(() => {});

    const unsubscribeBackend = window.electron.backend.onStateChange(
      (state: BackendState) => {
        if (
          !shouldAutoConnectChat({
            projectDirectory,
            restoreState: getChatRestoreState(),
          })
        ) {
          return;
        }
        if (state.status === 'error' && state.message) {
          appendSystemMessage(`Backend error: ${state.message}`, 'error');
        } else if (
          state.status === 'ready' &&
          !connectingRef.current &&
          (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) &&
          !!projectDirectory
        ) {
          connectWebSocket().catch(() => undefined);
        }
      },
    );

    return () => {
      unsubscribeBackend();
    };
  }, [
    connectWebSocket,
    appendSystemMessage,
    getChatRestoreState,
    projectDirectory,
  ]);

  useEffect(() => {
    return () => {
      const pendingStop = stopRequestRef.current;
      if (pendingStop) {
        clearTimeout(pendingStop.timeoutId);
        stopRequestRef.current = null;
        pendingStop.resolve(false);
      }
      flushSnapshotSave(currentProjectDirectoryRef.current);
      disconnectWebSocket();
      if (settingsReconnectTimeoutRef.current) {
        clearTimeout(settingsReconnectTimeoutRef.current);
      }
      if (statusUpdateTimeoutRef.current) {
        clearTimeout(statusUpdateTimeoutRef.current);
      }
    };
  }, [disconnectWebSocket, flushSnapshotSave]);

  // Restore chat snapshots and reconnect when workspace changes.
  const prevProjectDirectoryRef = useRef<string | null>(null);
  useEffect(() => {
    if (projectDirectory === prevProjectDirectoryRef.current) {
      return;
    }

    const previousProjectDirectory = prevProjectDirectoryRef.current;
    prevProjectDirectoryRef.current = projectDirectory || null;
    currentProjectDirectoryRef.current = projectDirectory || null;

    const pendingStop = stopRequestRef.current;
    if (pendingStop) {
      clearTimeout(pendingStop.timeoutId);
      stopRequestRef.current = null;
      pendingStop.resolve(false);
    }

    console.log('[ChatPanel] projectDirectory changed:', {
      newValue: projectDirectory,
      hasValue: !!projectDirectory,
    });

    if (previousProjectDirectory) {
      flushSnapshotSave(previousProjectDirectory);
    }

    disconnectWebSocket();
    reconnectAttemptRef.current = 0;
    connectionBannerRef.current = null;
    pendingOutboundActionsRef.current = [];
    setSetupPanelMode('hidden');
    setSetupStep('template');
    setSetupError(null);
    setIsProjectSetupConfigured(false);
    setIsConfiguringProjectSetup(false);
    setSelectedTemplateId(null);
    setSelectedStyleId(null);
    setSelectedDuration(null);
    setAutonomousModeEnabled(false);

    if (!projectDirectory) {
      setChatRestoreState(null, 'idle');
      resetConversationRefs();
      setMessages([]);
      setSessionId(null);
      setAgentStatus('idle');
      setAgentName('Kshana');
      setStatusMessage('Ready');
      setCurrentPhase(undefined);
      setPhaseDisplayName(undefined);
      setHasUserSentMessage(false);
      setIsTaskRunning(false);
      setIsStopPending(false);
      setAutonomousModeEnabled(false);
      setNotificationBanner(null);
      setSessionTimer({
        visible: false,
        elapsedMs: 0,
        running: false,
        completed: false,
      });
      return;
    }

    const reconnect = async () => {
      try {
        await restoreSnapshot(projectDirectory);
        const catalog = await ensureTemplateCatalogLoaded();
        const defaultSetup = deriveDefaultSetup(
          catalog.templates,
          catalog.durationPresets,
        );

        if (defaultSetup) {
          applySetupSelection(defaultSetup);
        }

        const persistedSetup = await loadPersistedSetup();
        if (persistedSetup && projectDirectory) {
          const persistedPayload: ConfigureProjectPayload = {
            templateId: persistedSetup.templateId,
            style: persistedSetup.style,
            duration: persistedSetup.duration,
            autonomousMode: Boolean(persistedSetup.autonomousMode),
            projectDir: projectDirectory,
            projectName: getProjectNameFromDirectory(projectDirectory),
          };
          applySetupSelection(persistedPayload);
          setSetupPanelMode('hidden');
          if (!sessionIdRef.current) {
            void configureProjectSetup(persistedPayload);
          } else {
            setIsProjectSetupConfigured(true);
          }
        } else {
          const pendingSetupDir = window.localStorage.getItem(
            PROJECT_SETUP_STORAGE_KEY,
          );
          const isPendingForCurrentProject =
            pendingSetupDir &&
            normalizeProjectDirectory(pendingSetupDir) ===
              normalizeProjectDirectory(projectDirectory);

          if (isPendingForCurrentProject) {
            window.localStorage.removeItem(PROJECT_SETUP_STORAGE_KEY);
            setSetupPanelMode('wizard');
            setSetupStep('template');
          } else {
            setSetupPanelMode('wizard');
            setSetupStep('template');
          }
        }

        const state = await window.electron.backend.getState();
        if (
          state.status === 'ready' &&
          isChatRestoreCompleteForProject(projectDirectory)
        ) {
          await connectWebSocket();
        }
      } catch (error) {
        console.error('[ChatPanel] Reconnect failed:', error);
      }
    };
    reconnect().catch(() => undefined);
  }, [
    connectWebSocket,
    disconnectWebSocket,
    ensureTemplateCatalogLoaded,
    deriveDefaultSetup,
    flushSnapshotSave,
    isChatRestoreCompleteForProject,
    projectDirectory,
    resetConversationRefs,
    restoreSnapshot,
    setChatRestoreState,
    applySetupSelection,
    loadPersistedSetup,
    configureProjectSetup,
  ]);

  const handleExportChat = useCallback(async () => {
    if (!projectDirectory) {
      appendSystemMessage(
        'Open a project before exporting chat history.',
        'error',
      );
      return;
    }

    const exportPayload: ChatExportPayload = {
      exportedAt: new Date().toISOString(),
      projectDirectory,
      sessionId: sessionIdRef.current,
      messages: messagesRef.current.map(
        (message) =>
          ({
            id: message.id,
            role: message.role,
            type: message.type,
            content: message.content,
            timestamp: message.timestamp,
            author: message.author,
            meta: message.meta,
          }) as PersistedChatMessage,
      ),
    };

    const result = await window.electron.project.exportChatJson(exportPayload);
    if (!result.success && !result.canceled) {
      appendSystemMessage(
        `Failed to export chat JSON: ${result.error || 'Unknown error'}`,
        'error',
      );
    }
  }, [appendSystemMessage, projectDirectory]);

  const activeQuestion = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.type !== 'agent_question') {
        continue;
      }

      const selectedResponse = message.meta?.selectedResponse as
        | string
        | undefined;
      if (selectedResponse) {
        return null;
      }

      return {
        id: message.id,
        question: message.content,
        options: ((message.meta?.options as ChatQuestionOption[]) || []).slice(
          0,
          9,
        ),
        type:
          (message.meta?.questionType as 'text' | 'confirm' | 'select') ||
          'text',
        isConfirmation: Boolean(message.meta?.isConfirmation),
        autoApproveTimeoutMs: message.meta?.autoApproveTimeoutMs as
          | number
          | undefined,
        defaultOption: message.meta?.defaultOption as string | undefined,
      };
    }

    return null;
  }, [messages]);

  const { cancelActiveQuestionTimer, effectiveAutoApproveTimeoutMs } =
    useQuestionTimerCancellation({
      activeQuestion,
      questionTimerCancelledForId,
      setQuestionTimerCancelledForId,
    });

  const activeTodos = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.type !== 'todo_update') {
        continue;
      }

      const todos = (message.meta?.todos as Array<any> | undefined) || [];
      return todos.length > 0 ? todos : null;
    }

    return null;
  }, [messages]);

  const showDockedTodoPrompt =
    setupPanelMode === 'hidden' && !activeQuestion && !!activeTodos;

  useEffect(() => {
    if (isTaskRunning) {
      return;
    }

    const hasExecutingToolCall = messages.some(
      (message) =>
        message.type === 'tool_call' &&
        (message.meta?.status === 'executing' ||
          message.meta?.status === 'started'),
    );

    if (!hasExecutingToolCall) {
      return;
    }

    if (agentStatus === 'error') {
      settleActiveToolCalls(
        'error',
        statusMessage || 'Run ended with an error.',
      );
      return;
    }

    const completionMessage = activeQuestion
      ? 'Waiting for your input.'
      : statusMessage || 'Run finished.';
    settleActiveToolCalls('completed', completionMessage);
  }, [
    activeQuestion,
    agentStatus,
    isTaskRunning,
    messages,
    settleActiveToolCalls,
    statusMessage,
  ]);

  useEffect(() => {
    if (isTaskRunning || !sessionTimer.running) {
      return;
    }

    setSessionTimer((prev) => ({
      ...prev,
      running: false,
      completed: prev.completed || agentStatus === 'completed',
    }));
  }, [agentStatus, isTaskRunning, sessionTimer.running]);
  // Never show legacy greeting messages.
  const filteredMessages = useMemo(() => {
    return messages.filter(
      (msg) =>
        !(msg.type === 'greeting' && msg.role === 'system') &&
        msg.type !== 'agent_question' &&
        msg.type !== 'todo_update' &&
        msg.type !== 'status' &&
        msg.type !== 'progress' &&
        msg.type !== 'comfyui_progress' &&
        msg.type !== 'notification',
    );
  }, [messages]);

  const showThinkingPlaceholder = useMemo(() => {
    if (!isTaskRunning) {
      return false;
    }

    return filteredMessages.every((message) => message.role === 'user');
  }, [filteredMessages, isTaskRunning]);

  const thinkingPlaceholderText = useMemo(() => {
    if (statusMessage.trim()) {
      return statusMessage;
    }

    if (agentStatus === 'executing') {
      return 'Running tools in the background...';
    }

    return 'Thinking through the next steps...';
  }, [agentStatus, statusMessage]);

  const chatInputPlaceholder = useMemo(() => {
    if (activeQuestion && (activeQuestion.options?.length || 0) > 0) {
      return 'Choose an option above, press 1-9, or type a custom reply…';
    }

    if (activeQuestion) {
      return 'Type your answer to continue…';
    }

    if (showDockedTodoPrompt) {
      return isTaskRunning
        ? 'Current task progress is shown above. Use Stop if you want to interrupt this run…'
        : 'Continue the workflow, refine the output, or ask for the next step…';
    }

    return 'Describe your story, ask for a storyboard, or request assets…';
  }, [activeQuestion, isTaskRunning, showDockedTodoPrompt]);

  const chatInputHint = useMemo(() => {
    if (activeQuestion && (activeQuestion.options?.length || 0) > 0) {
      return 'Quick reply: press 1-9, click an option, or type your own answer and send.';
    }

    if (activeQuestion) {
      return 'Answer the active question here to continue the workflow.';
    }

    if (showDockedTodoPrompt) {
      return isTaskRunning
        ? 'Live task progress is docked above the composer.'
        : 'Latest task progress is docked above. You can keep iterating from here.';
    }

    return undefined;
  }, [activeQuestion, isTaskRunning, showDockedTodoPrompt]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {createElement(Bot as any, { size: 18, className: styles.headerIcon })}
        <span className={styles.headerTitle}>Kshana Assistant</span>
        <button
          type="button"
          className={`${styles.autonomousButton} ${
            autonomousModeEnabled ? styles.autonomousButtonActive : ''
          }`}
          onClick={handleToggleAutonomousMode}
          title="Toggle autonomous mode"
          aria-pressed={autonomousModeEnabled}
          disabled={!sessionId || !isProjectSetupConfigured}
        >
          <span>AUTO</span>
        </button>
        <button
          type="button"
          className={styles.exportButton}
          onClick={handleExportChat}
          title="Export chat history as JSON"
          aria-label="Export chat history as JSON"
        >
          {createElement(Download as any, { size: 14 })}
          <span>Export Chat</span>
        </button>
        <button
          type="button"
          className={styles.clearButton}
          onClick={clearChat}
          title="Clear chat"
        >
          {createElement(Trash2 as any, { size: 14 })}
          <span>Clear</span>
        </button>
      </div>

      <StatusBar
        agentName={agentName}
        status={agentStatus}
        message={statusMessage}
        currentPhase={currentPhase}
        phaseDisplayName={phaseDisplayName}
        sessionTimer={sessionTimer}
      />

      {notificationBanner && (
        <div
          className={`${styles.notificationBanner} ${
            styles[
              `notification${notificationBanner.level[0].toUpperCase()}${notificationBanner.level.slice(1)}`
            ]
          }`}
          role="status"
          aria-live="polite"
        >
          {notificationBanner.message}
        </div>
      )}

      <div className={styles.messages}>
        <MessageList
          messages={filteredMessages}
          isStreaming={isStreaming}
          showThinkingPlaceholder={showThinkingPlaceholder}
          thinkingPlaceholderText={thinkingPlaceholderText}
          thinkingAgentName={agentName}
          onDelete={deleteMessage}
        />
      </div>

      <ProjectSetupPanel
        mode={setupPanelMode}
        step={setupStep}
        templates={setupTemplates}
        durationPresets={setupDurationPresets}
        selectedTemplateId={selectedTemplateId}
        selectedStyleId={selectedStyleId}
        selectedDuration={selectedDuration}
        selectedAutonomousMode={autonomousModeEnabled}
        loading={isLoadingSetupCatalog}
        configuring={isConfiguringProjectSetup}
        error={setupError}
        onOpenWizard={openSetupWizard}
        onEditSetup={handleSetupEdit}
        onSelectTemplate={handleSelectTemplate}
        onSelectStyle={handleSelectStyle}
        onSelectDuration={handleSelectDuration}
        onSelectAutonomousMode={handleSelectAutonomousMode}
        onConfirmSetup={handleConfirmSetup}
        onBack={handleSetupBack}
      />

      {showDockedTodoPrompt && (
        <TodoPrompt todos={activeTodos} isRunning={isTaskRunning} />
      )}

      {setupPanelMode === 'hidden' && activeQuestion && (
        <QuestionPrompt
          question={activeQuestion.question}
          options={activeQuestion.options}
          type={activeQuestion.type}
          autoApproveTimeoutMs={effectiveAutoApproveTimeoutMs}
          isConfirmation={activeQuestion.isConfirmation}
          defaultOption={activeQuestion.defaultOption}
          onSelect={sendResponse}
        />
      )}

      <ChatInput
        disabled={
          connectionState === 'connecting' ||
          isConfiguringProjectSetup ||
          setupPanelMode === 'wizard'
        }
        isRunning={isTaskRunning}
        isStopping={isStopPending}
        placeholder={chatInputPlaceholder}
        hintText={chatInputHint}
        questionMode={!!activeQuestion && setupPanelMode === 'hidden'}
        onQuestionInteraction={cancelActiveQuestionTimer}
        onSend={sendMessage}
        onStop={stopTask}
      />
    </div>
  );
}
