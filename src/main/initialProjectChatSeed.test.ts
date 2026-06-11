import { describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { seedInitialProjectChatHistory } from './initialProjectChatSeed';
import { projectSlugFromDir } from './projectSessionSlug';

describe('seedInitialProjectChatHistory', () => {
  it('writes the setup story and receipt to the project-scoped session dir', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dhee-seed-chat-'));
    try {
      const projectDir = path.join(root, 'projects', 'Same Story');
      const userDataDir = path.join(root, 'userData');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        path.join(projectDir, 'project.json'),
        JSON.stringify({ projectId: 'project-seed-1' }),
        'utf8',
      );

      await seedInitialProjectChatHistory({
        userDataDir,
        projectDir,
        story: 'A young engineer discovers a traffic glitch.',
        bundleId: 'youtube_short_text_video',
      });

      const sessionsDir = path.join(
        userDataDir,
        'pi-sessions',
        projectSlugFromDir(projectDir),
      );
      const files = readdirSync(sessionsDir).filter((file) =>
        file.endsWith('.jsonl'),
      );
      expect(files).toHaveLength(1);
      const lines = readFileSync(path.join(sessionsDir, files[0]!), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { message: { role: string; content: string } });

      expect(lines[0]?.message).toMatchObject({
        role: 'user',
        content: 'A young engineer discovers a traffic glitch.',
      });
      expect(lines[1]?.message).toMatchObject({
        role: 'assistant',
        content: expect.stringContaining('youtube_short_text_video'),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
