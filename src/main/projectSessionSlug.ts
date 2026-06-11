import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export function normalizeProjectDirForSession(projectDir: string): string {
  return path.resolve(projectDir).replace(/\\/g, '/').replace(/\/+$/, '');
}

export function readProjectIdForSession(projectDir: string): string | null {
  try {
    const projectJsonPath = path.join(projectDir, 'project.json');
    if (!existsSync(projectJsonPath)) return null;
    const project = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
      projectId?: unknown;
    };
    const projectId = typeof project.projectId === 'string'
      ? project.projectId.trim()
      : '';
    return projectId || null;
  } catch {
    return null;
  }
}

export function projectSessionIdentity(projectDir: string): string {
  return readProjectIdForSession(projectDir) ?? normalizeProjectDirForSession(projectDir);
}

export function projectSlugFromDir(projectDir: string): string {
  const normalized = normalizeProjectDirForSession(projectDir);
  const safeBase =
    path.basename(normalized).replace(/[^A-Za-z0-9_\-]+/g, '_') || 'project';
  const hash = createHash('sha256')
    .update(projectSessionIdentity(projectDir))
    .digest('hex')
    .slice(0, 12);
  return `${safeBase}-${hash}`;
}

export function projectSessionsDirFromDir(
  userDataDir: string,
  projectDir: string,
): string {
  return path.join(userDataDir, 'pi-sessions', projectSlugFromDir(projectDir));
}
