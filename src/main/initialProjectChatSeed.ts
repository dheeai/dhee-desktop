import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { projectSessionsDirFromDir } from './projectSessionSlug';

function messageRecord(
  role: 'user' | 'assistant',
  content: string,
  timestamp: number,
): string {
  return JSON.stringify({
    type: 'message',
    id: `initial-${role}-${timestamp}-${randomUUID()}`,
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role,
      content,
      timestamp,
    },
  });
}

export async function seedInitialProjectChatHistory(params: {
  userDataDir: string;
  projectDir: string;
  story: unknown;
  bundleId: string;
}): Promise<void> {
  const story = typeof params.story === 'string' ? params.story.trim() : '';
  if (!story) return;

  const sessionsDir = projectSessionsDirFromDir(
    params.userDataDir,
    params.projectDir,
  );
  await fs.mkdir(sessionsDir, { recursive: true });
  const now = Date.now();
  const sessionFile = path.join(
    sessionsDir,
    `initial-${now}-${randomUUID()}.jsonl`,
  );
  const receipt =
    `Project created with ${params.bundleId}. ` +
    'Ready to continue generation from this story.';
  await fs.writeFile(
    sessionFile,
    [
      messageRecord('user', story, now),
      messageRecord('assistant', receipt, now + 1),
    ].join('\n') + '\n',
    'utf8',
  );
}
