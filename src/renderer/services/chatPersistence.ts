import type { ChatMessage } from '../types/chat';
import { safeJsonParse } from '../utils/safeJsonParse';
import {
  CHAT_SNAPSHOT_VERSION,
  MAX_PERSISTED_CHAT_MESSAGES,
  type ChatSnapshot,
  type ChatSnapshotUiState,
  type PersistedChatMessage,
} from '../../shared/chatTypes';

const CHAT_HISTORY_RELATIVE_PATH = 'chat-history.json';

export interface ChatSnapshotStorage {
  readFile(filePath: string): Promise<string | null>;
  writeFile(filePath: string, content: string): Promise<void>;
}

const VALID_ROLES = new Set(['user', 'assistant', 'system']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeNestedProjectMetadata(
  value: unknown,
  expectedProjectDirectory: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeNestedProjectMetadata(item, expectedProjectDirectory),
    );
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitizedEntries = Object.entries(value).map(([key, nestedValue]) => {
    if (
      (key === 'projectDirectory' || key === 'project_directory') &&
      typeof nestedValue === 'string' &&
      nestedValue.trim() &&
      nestedValue !== expectedProjectDirectory
    ) {
      return [key, expectedProjectDirectory];
    }

    return [
      key,
      sanitizeNestedProjectMetadata(nestedValue, expectedProjectDirectory),
    ];
  });

  return Object.fromEntries(sanitizedEntries);
}

function normalizePersistedMessage(
  value: unknown,
  expectedProjectDirectory: string,
): PersistedChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const id =
    typeof value.id === 'string' && value.id.trim().length > 0
      ? value.id
      : null;
  const role =
    typeof value.role === 'string' && VALID_ROLES.has(value.role)
      ? (value.role as PersistedChatMessage['role'])
      : null;
  const type = typeof value.type === 'string' ? value.type : null;
  const content = typeof value.content === 'string' ? value.content : null;
  const timestamp =
    typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
      ? value.timestamp
      : null;

  if (!id || !role || !type || content === null || timestamp === null) {
    return null;
  }

  return {
    id,
    role,
    type,
    content,
    timestamp,
    author: typeof value.author === 'string' ? value.author : undefined,
    meta: isRecord(value.meta)
      ? (sanitizeNestedProjectMetadata(
          value.meta,
          expectedProjectDirectory,
        ) as Record<string, unknown>)
      : undefined,
  };
}

function normalizeUiState(value: unknown): ChatSnapshotUiState {
  if (!isRecord(value)) {
    return {
      agentStatus: 'idle',
      agentName: 'dhee',
      statusMessage: 'Ready',
      hasUserSentMessage: false,
      isTaskRunning: false,
      autonomousMode: false,
    };
  }

  const currentPhase =
    typeof value.currentPhase === 'string' ? value.currentPhase : undefined;
  const phaseDisplayName =
    typeof value.phaseDisplayName === 'string'
      ? value.phaseDisplayName
      : undefined;

  return {
    agentStatus:
      typeof value.agentStatus === 'string' ? value.agentStatus : 'idle',
    agentName: typeof value.agentName === 'string' ? value.agentName : 'dhee',
    statusMessage:
      typeof value.statusMessage === 'string' ? value.statusMessage : 'Ready',
    currentPhase,
    phaseDisplayName,
    hasUserSentMessage: Boolean(value.hasUserSentMessage),
    isTaskRunning: Boolean(value.isTaskRunning),
    autonomousMode: Boolean(value.autonomousMode),
  };
}

function mapToPersistedMessage(message: ChatMessage): PersistedChatMessage {
  return {
    id: message.id,
    role: message.role,
    type: message.type,
    content: message.content,
    timestamp: message.timestamp,
    author: message.author,
    meta: message.meta,
  };
}

export function getChatHistoryFilePath(projectDirectory: string): string {
  const normalizedProjectDir = projectDirectory.replace(/[\\/]+$/, '');
  return `${normalizedProjectDir}/${CHAT_HISTORY_RELATIVE_PATH}`;
}

export function prunePersistedMessages(
  messages: PersistedChatMessage[],
  maxMessages: number = MAX_PERSISTED_CHAT_MESSAGES,
): PersistedChatMessage[] {
  if (messages.length <= maxMessages) {
    return [...messages];
  }
  return messages.slice(messages.length - maxMessages);
}

export function createChatSnapshot(params: {
  projectDirectory: string;
  sessionId: string | null;
  messages: ChatMessage[];
  uiState: ChatSnapshotUiState;
  maxMessages?: number;
}): ChatSnapshot {
  const maxMessages = params.maxMessages ?? MAX_PERSISTED_CHAT_MESSAGES;
  const persistedMessages = prunePersistedMessages(
    params.messages.map(mapToPersistedMessage),
    maxMessages,
  );

  return {
    version: CHAT_SNAPSHOT_VERSION,
    projectDirectory: params.projectDirectory,
    sessionId: params.sessionId,
    messages: persistedMessages,
    uiState: params.uiState,
  };
}

export function parseChatSnapshot(
  rawContent: string,
  expectedProjectDirectory: string,
  maxMessages: number = MAX_PERSISTED_CHAT_MESSAGES,
): ChatSnapshot | null {
  let parsed: unknown;
  try {
    parsed = safeJsonParse<unknown>(rawContent);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const projectDirectory =
    typeof parsed.projectDirectory === 'string'
      ? parsed.projectDirectory
      : null;
  if (!projectDirectory || projectDirectory !== expectedProjectDirectory) {
    return null;
  }

  const sessionId =
    typeof parsed.sessionId === 'string' ? parsed.sessionId : null;
  const messages = Array.isArray(parsed.messages)
    ? parsed.messages
        .map((message) =>
          normalizePersistedMessage(message, expectedProjectDirectory),
        )
        .filter((message): message is PersistedChatMessage => message !== null)
    : [];

  return {
    version:
      typeof parsed.version === 'number'
        ? parsed.version
        : CHAT_SNAPSHOT_VERSION,
    projectDirectory,
    sessionId,
    messages: prunePersistedMessages(messages, maxMessages),
    uiState: normalizeUiState(parsed.uiState),
  };
}

function getDefaultStorage(): ChatSnapshotStorage {
  return {
    readFile: (filePath: string) => window.electron.project.readFile(filePath),
    writeFile: (filePath: string, content: string) =>
      window.electron.project.writeFile(filePath, content),
  };
}

export async function loadChatSnapshot(
  projectDirectory: string,
  storage: ChatSnapshotStorage = getDefaultStorage(),
): Promise<ChatSnapshot | null> {
  const filePath = getChatHistoryFilePath(projectDirectory);
  const content = await storage.readFile(filePath);
  if (!content) {
    return null;
  }
  return parseChatSnapshot(content, projectDirectory);
}

export async function saveChatSnapshot(
  snapshot: ChatSnapshot,
  storage: ChatSnapshotStorage = getDefaultStorage(),
): Promise<void> {
  const filePath = getChatHistoryFilePath(snapshot.projectDirectory);
  const normalizedSnapshot: ChatSnapshot = {
    ...snapshot,
    version: CHAT_SNAPSHOT_VERSION,
    messages: prunePersistedMessages(snapshot.messages),
  };
  await storage.writeFile(
    filePath,
    JSON.stringify(normalizedSnapshot, null, 2),
  );
}
