import { describe, expect, it } from '@jest/globals';
import {
  CHAT_SNAPSHOT_VERSION,
  MAX_PERSISTED_CHAT_MESSAGES,
  type ChatSnapshot,
  type PersistedChatMessage,
} from '../../shared/chatTypes';
import {
  createChatSnapshot,
  getChatHistoryFilePath,
  loadChatSnapshot,
  parseChatSnapshot,
  saveChatSnapshot,
} from './chatPersistence';

class InMemoryStorage {
  private files = new Map<string, string>();

  async readFile(filePath: string): Promise<string | null> {
    return this.files.get(filePath) ?? null;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  setRaw(filePath: string, content: string): void {
    this.files.set(filePath, content);
  }
}

function makeMessage(id: string): PersistedChatMessage {
  return {
    id,
    role: 'assistant',
    type: 'agent_response',
    content: `message-${id}`,
    timestamp: Number(id),
  };
}

describe('chatPersistence', () => {
  it('saves and loads snapshot round-trip', async () => {
    const storage = new InMemoryStorage();
    const snapshot = createChatSnapshot({
      projectDirectory: '/tmp/project-a',
      sessionId: 'session-a',
      messages: [
        {
          id: '1',
          role: 'user',
          type: 'message',
          content: 'hello',
          timestamp: 1,
        },
        {
          id: '2',
          role: 'assistant',
          type: 'agent_response',
          content: 'world',
          timestamp: 2,
        },
      ],
      uiState: {
        agentStatus: 'completed',
        agentName: 'dhee',
        statusMessage: 'Done',
        hasUserSentMessage: true,
        isTaskRunning: false,
        autonomousMode: true,
      },
    });

    await saveChatSnapshot(snapshot, storage);

    const loaded = await loadChatSnapshot('/tmp/project-a', storage);
    expect(loaded).toEqual(snapshot);
  });

  it('recovers from invalid JSON by returning null', async () => {
    const storage = new InMemoryStorage();
    const filePath = getChatHistoryFilePath('/tmp/project-a');
    storage.setRaw(filePath, '{not-valid-json');

    const loaded = await loadChatSnapshot('/tmp/project-a', storage);
    expect(loaded).toBeNull();
  });

  it('prunes persisted messages to max cap', async () => {
    const storage = new InMemoryStorage();
    const oversizeMessages = Array.from(
      { length: MAX_PERSISTED_CHAT_MESSAGES + 200 },
      (_, index) => makeMessage(String(index + 1)),
    );

    const snapshot: ChatSnapshot = {
      version: CHAT_SNAPSHOT_VERSION,
      projectDirectory: '/tmp/project-a',
      sessionId: 'session-a',
      messages: oversizeMessages,
      uiState: {
        agentStatus: 'idle',
        agentName: 'dhee',
        statusMessage: 'Ready',
        hasUserSentMessage: false,
        isTaskRunning: false,
        autonomousMode: false,
      },
    };

    await saveChatSnapshot(snapshot, storage);
    const loaded = await loadChatSnapshot('/tmp/project-a', storage);

    expect(loaded).not.toBeNull();
    expect(loaded?.messages).toHaveLength(MAX_PERSISTED_CHAT_MESSAGES);
    expect(loaded?.messages[0]?.id).toBe('201');
    expect(loaded?.messages.at(-1)?.id).toBe(
      String(MAX_PERSISTED_CHAT_MESSAGES + 200),
    );
  });

  it('keeps project histories independent across project switches', async () => {
    const storage = new InMemoryStorage();

    const projectASnapshot = createChatSnapshot({
      projectDirectory: '/tmp/project-a',
      sessionId: 'session-a',
      messages: [
        {
          id: '1',
          role: 'assistant',
          type: 'agent_response',
          content: 'project-a-message',
          timestamp: 1,
        },
      ],
      uiState: {
        agentStatus: 'idle',
        agentName: 'dhee',
        statusMessage: 'Ready',
        hasUserSentMessage: true,
        isTaskRunning: false,
        autonomousMode: false,
      },
    });

    const projectBSnapshot = createChatSnapshot({
      projectDirectory: '/tmp/project-b',
      sessionId: 'session-b',
      messages: [
        {
          id: '1',
          role: 'assistant',
          type: 'agent_response',
          content: 'project-b-message',
          timestamp: 1,
        },
      ],
      uiState: {
        agentStatus: 'idle',
        agentName: 'dhee',
        statusMessage: 'Ready',
        hasUserSentMessage: true,
        isTaskRunning: false,
        autonomousMode: true,
      },
    });

    await saveChatSnapshot(projectASnapshot, storage);
    await saveChatSnapshot(projectBSnapshot, storage);

    const loadedA = await loadChatSnapshot('/tmp/project-a', storage);
    const loadedB = await loadChatSnapshot('/tmp/project-b', storage);

    expect(loadedA?.messages[0]?.content).toBe('project-a-message');
    expect(loadedB?.messages[0]?.content).toBe('project-b-message');
    expect(loadedA?.sessionId).toBe('session-a');
    expect(loadedB?.sessionId).toBe('session-b');
  });

  it('rejects snapshot if projectDirectory does not match', () => {
    const parsed = parseChatSnapshot(
      JSON.stringify({
        version: 1,
        projectDirectory: '/tmp/project-a',
        sessionId: 'session-a',
        messages: [],
        uiState: {},
      }),
      '/tmp/project-b',
    );

    expect(parsed).toBeNull();
  });

  it('defaults autonomous mode to false for older snapshots', () => {
    const parsed = parseChatSnapshot(
      JSON.stringify({
        version: 1,
        projectDirectory: '/tmp/project-a',
        sessionId: 'session-a',
        messages: [],
        uiState: {
          agentStatus: 'idle',
          agentName: 'dhee',
          statusMessage: 'Ready',
          hasUserSentMessage: false,
          isTaskRunning: false,
        },
      }),
      '/tmp/project-a',
    );

    expect(parsed?.uiState.autonomousMode).toBe(false);
  });

  it('sanitizes nested foreign project paths in restored message metadata', () => {
    const parsed = parseChatSnapshot(
      JSON.stringify({
        version: 1,
        projectDirectory: '/tmp/project-a',
        sessionId: 'session-a',
        messages: [
          {
            id: '1',
            role: 'system',
            type: 'tool_call',
            content: '',
            timestamp: 1,
            meta: {
              result: {
                project_directory: '/Users/other/Documents/dhee/project-a',
                nested: {
                  projectDirectory: '/Users/other/Documents/dhee/project-a',
                },
              },
            },
          },
        ],
        uiState: {},
      }),
      '/tmp/project-a',
    );

    expect(parsed?.messages[0]?.meta).toEqual({
      result: {
        project_directory: '/tmp/project-a',
        nested: {
          projectDirectory: '/tmp/project-a',
        },
      },
    });
  });
});
