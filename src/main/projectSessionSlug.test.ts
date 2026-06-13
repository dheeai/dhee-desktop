import { describe, expect, it } from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  projectSessionsDirFromDir,
  projectSlugFromDir,
  readProjectSessionMeta,
} from './projectSessionSlug';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dhee-session-slug-'));
}

function writeProject(projectDir: string, projectId?: string): void {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'project.json'),
    JSON.stringify(projectId ? { projectId } : {}),
    'utf8',
  );
}

function writeMeta(
  sessionDir: string,
  meta: { projectDir: string; projectId?: string; createdAt?: string },
): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, 'meta.json'),
    JSON.stringify({
      projectDir: meta.projectDir,
      ...(meta.projectId ? { projectId: meta.projectId } : {}),
      createdAt: meta.createdAt ?? '2026-06-12T00:00:00.000Z',
    }),
    'utf8',
  );
}

describe('projectSessionsDirFromDir', () => {
  it('uses an explicit meta.json projectId match before computed slug folders', () => {
    const root = tempRoot();
    try {
      const userDataDir = join(root, 'userData');
      const projectDir = join(root, 'projects', 'Renamed Project');
      writeProject(projectDir, 'stable-project-id');
      const explicitDir = join(userDataDir, 'pi-sessions', 'cursor-style-store');
      writeMeta(explicitDir, {
        projectDir: join(root, 'old-location', 'Renamed Project'),
        projectId: 'stable-project-id',
      });
      const hashedDir = join(
        userDataDir,
        'pi-sessions',
        projectSlugFromDir(projectDir),
      );
      mkdirSync(hashedDir, { recursive: true });

      const resolved = projectSessionsDirFromDir(userDataDir, projectDir);

      expect(resolved).toBe(explicitDir);
      expect(readProjectSessionMeta(explicitDir)).toMatchObject({
        projectDir,
        projectId: 'stable-project-id',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses an explicit meta.json projectDir match when projectId is absent', () => {
    const root = tempRoot();
    try {
      const userDataDir = join(root, 'userData');
      const projectDir = join(root, 'projects', 'Path Matched');
      writeProject(projectDir);
      const explicitDir = join(userDataDir, 'pi-sessions', 'explicit-path');
      writeMeta(explicitDir, { projectDir });

      expect(projectSessionsDirFromDir(userDataDir, projectDir)).toBe(
        explicitDir,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses an existing hashed folder and writes meta.json into it', () => {
    const root = tempRoot();
    try {
      const userDataDir = join(root, 'userData');
      const projectDir = join(root, 'projects', 'Hashed Project');
      writeProject(projectDir, 'hashed-project-id');
      const hashedDir = join(
        userDataDir,
        'pi-sessions',
        projectSlugFromDir(projectDir),
      );
      mkdirSync(hashedDir, { recursive: true });

      expect(projectSessionsDirFromDir(userDataDir, projectDir)).toBe(
        hashedDir,
      );
      expect(readProjectSessionMeta(hashedDir)).toMatchObject({
        projectDir,
        projectId: 'hashed-project-id',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adopts a legacy basename folder in place by writing meta.json', () => {
    const root = tempRoot();
    try {
      const userDataDir = join(root, 'userData');
      const projectDir = join(root, 'projects', 'normal-boy2');
      writeProject(projectDir);
      const legacyDir = join(userDataDir, 'pi-sessions', 'normal-boy2');
      const hashedDir = join(
        userDataDir,
        'pi-sessions',
        projectSlugFromDir(projectDir),
      );
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, 'legacy.jsonl'), '{"type":"message"}\n');

      const resolved = projectSessionsDirFromDir(userDataDir, projectDir);

      expect(resolved).toBe(legacyDir);
      expect(existsSync(legacyDir)).toBe(true);
      expect(existsSync(hashedDir)).toBe(false);
      expect(readProjectSessionMeta(legacyDir)).toMatchObject({ projectDir });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers the hashed folder over an untagged legacy folder when both exist', () => {
    const root = tempRoot();
    try {
      const userDataDir = join(root, 'userData');
      const projectDir = join(root, 'projects', 'Both Exist');
      writeProject(projectDir);
      const legacyDir = join(userDataDir, 'pi-sessions', 'Both Exist');
      const hashedDir = join(
        userDataDir,
        'pi-sessions',
        projectSlugFromDir(projectDir),
      );
      mkdirSync(legacyDir, { recursive: true });
      mkdirSync(hashedDir, { recursive: true });

      expect(projectSessionsDirFromDir(userDataDir, projectDir)).toBe(
        hashedDir,
      );
      expect(readProjectSessionMeta(hashedDir)).toMatchObject({ projectDir });
      expect(existsSync(join(legacyDir, 'meta.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns the computed hashed folder for a new project without creating it', () => {
    const root = tempRoot();
    try {
      const userDataDir = join(root, 'userData');
      const projectDir = join(root, 'projects', 'Fresh Project');
      writeProject(projectDir);
      const hashedDir = join(
        userDataDir,
        'pi-sessions',
        projectSlugFromDir(projectDir),
      );

      expect(projectSessionsDirFromDir(userDataDir, projectDir)).toBe(
        hashedDir,
      );
      expect(existsSync(hashedDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves an existing meta.json createdAt when adopting a folder', () => {
    const root = tempRoot();
    try {
      const userDataDir = join(root, 'userData');
      const projectDir = join(root, 'projects', 'Created At');
      writeProject(projectDir);
      const explicitDir = join(userDataDir, 'pi-sessions', 'explicit-created');
      writeMeta(explicitDir, {
        projectDir,
        createdAt: '2020-01-02T03:04:05.000Z',
      });

      projectSessionsDirFromDir(userDataDir, projectDir);
      const raw = JSON.parse(
        readFileSync(join(explicitDir, 'meta.json'), 'utf8'),
      ) as { createdAt?: string };

      expect(raw.createdAt).toBe('2020-01-02T03:04:05.000Z');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
