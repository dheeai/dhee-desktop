import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';

export interface ProjectSessionMeta {
  projectDir: string;
  projectId?: string;
  createdAt: string;
}

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

export function projectSessionsRoot(userDataDir: string): string {
  return path.join(userDataDir, 'pi-sessions');
}

function safeReadSessionMeta(sessionDir: string): ProjectSessionMeta | null {
  try {
    const raw = readFileSync(path.join(sessionDir, 'meta.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      projectDir?: unknown;
      projectId?: unknown;
      createdAt?: unknown;
    };
    if (typeof parsed.projectDir !== 'string' || !parsed.projectDir.trim()) {
      return null;
    }
    const projectDir = normalizeProjectDirForSession(parsed.projectDir);
    const projectId =
      typeof parsed.projectId === 'string' && parsed.projectId.trim().length > 0
        ? parsed.projectId.trim()
        : undefined;
    const createdAt =
      typeof parsed.createdAt === 'string' && parsed.createdAt.trim().length > 0
        ? parsed.createdAt.trim()
        : new Date(0).toISOString();
    return {
      projectDir,
      ...(projectId ? { projectId } : {}),
      createdAt,
    };
  } catch {
    return null;
  }
}

export function readProjectSessionMeta(
  sessionDir: string,
): ProjectSessionMeta | null {
  return safeReadSessionMeta(sessionDir);
}

export function writeProjectSessionMeta(
  sessionDir: string,
  projectDir: string,
): ProjectSessionMeta {
  const previous = safeReadSessionMeta(sessionDir);
  const normalizedProjectDir = normalizeProjectDirForSession(projectDir);
  const projectId = readProjectIdForSession(projectDir) ?? previous?.projectId;
  const meta: ProjectSessionMeta = {
    projectDir: normalizedProjectDir,
    ...(projectId ? { projectId } : {}),
    createdAt: previous?.createdAt ?? new Date().toISOString(),
  };
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    path.join(sessionDir, 'meta.json'),
    JSON.stringify(meta, null, 2) + '\n',
    'utf8',
  );
  return meta;
}

function sessionDirsWithMeta(sessionsRoot: string): Array<{
  dir: string;
  meta: ProjectSessionMeta;
}> {
  if (!existsSync(sessionsRoot)) return [];
  try {
    return readdirSync(sessionsRoot)
      .sort()
      .flatMap((entry) => {
        const dir = path.join(sessionsRoot, entry);
        try {
          if (!statSync(dir).isDirectory()) return [];
        } catch {
          return [];
        }
        const meta = safeReadSessionMeta(dir);
        return meta ? [{ dir, meta }] : [];
      });
  } catch {
    return [];
  }
}

export function projectSessionsDirFromDir(
  userDataDir: string,
  projectDir: string,
): string {
  const sessionsRoot = projectSessionsRoot(userDataDir);
  const normalized = normalizeProjectDirForSession(projectDir);
  const projectId = readProjectIdForSession(projectDir);

  const metaMatches = sessionDirsWithMeta(sessionsRoot);
  if (projectId) {
    const byProjectId = metaMatches.find(
      ({ meta }) => meta.projectId === projectId,
    );
    if (byProjectId) {
      writeProjectSessionMeta(byProjectId.dir, projectDir);
      return byProjectId.dir;
    }
  }
  const byProjectDir = metaMatches.find(
    ({ meta }) => normalizeProjectDirForSession(meta.projectDir) === normalized,
  );
  if (byProjectDir) {
    writeProjectSessionMeta(byProjectDir.dir, projectDir);
    return byProjectDir.dir;
  }

  const hashedDir = path.join(sessionsRoot, projectSlugFromDir(projectDir));
  if (existsSync(hashedDir)) {
    writeProjectSessionMeta(hashedDir, projectDir);
    return hashedDir;
  }

  const legacyDir = path.join(sessionsRoot, path.basename(normalized));
  if (existsSync(legacyDir)) {
    writeProjectSessionMeta(legacyDir, projectDir);
    return legacyDir;
  }

  return hashedDir;
}
