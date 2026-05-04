/**
 * Classify a kshana project's lifecycle state so the chat panel can
 * pick the right contextual call-to-action when the user opens it.
 *
 *   'fresh'        — project.json missing required setup fields.
 *                    The new-project wizard handles this state.
 *   'in_progress'  — project.json is configured (style/duration/template
 *                    persisted) and goal.status is anything other than
 *                    'achieved'. Offer "continue" / "check status".
 *   'completed'    — project.json's goal.status === 'achieved' (or the
 *                    achievedAt timestamp is set defensively).
 *                    Offer "show final video" / "polish a shot".
 *
 * **project.json is the only source of truth.** The asset manifest
 * (`assets/manifest.json`) is an output index of generated media — it
 * is NEVER consulted for lifecycle classification. See
 * memory/feedback_project_state_truth.md.
 *
 * The completion marker `goal.status = 'achieved'` is written by
 * `src/core/tools/builtin/plannerTools.ts:248` when the planner sees
 * zero remaining steps.
 *
 * Pure async — takes a `ProjectFileReader` so it can be tested with
 * synthetic fixtures and used in the renderer (where the real reader
 * is `window.electron.project.readFile`).
 */

export type ProjectLifecycleState = 'fresh' | 'in_progress' | 'completed';

export interface ProjectFileReader {
  readFile: (path: string) => Promise<string | null>;
}

interface ProjectJsonShape {
  style?: unknown;
  templateId?: unknown;
  duration?: unknown;
  targetDuration?: unknown;
  goal?: { status?: unknown; achievedAt?: unknown };
}

function isConfigured(p: ProjectJsonShape): boolean {
  if (typeof p.style !== 'string' || p.style.trim().length === 0) return false;
  if (typeof p.templateId !== 'string' || p.templateId.trim().length === 0) {
    return false;
  }
  const dur =
    typeof p.targetDuration === 'number' ? p.targetDuration : p.duration;
  if (typeof dur !== 'number') return false;
  return true;
}

function isAchieved(p: ProjectJsonShape): boolean {
  const g = p.goal;
  if (!g || typeof g !== 'object') return false;
  if (g.status === 'achieved') return true;
  // Defensive: if achievedAt is set but status got desynced (legacy
  // projects, manual edits), still treat as completed.
  if (typeof g.achievedAt === 'number' && g.achievedAt > 0) return true;
  return false;
}

async function readJson<T>(
  reader: ProjectFileReader,
  path: string,
): Promise<T | null> {
  let content: string | null = null;
  try {
    content = await reader.readFile(path);
  } catch {
    return null;
  }
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function classifyProjectState(
  projectDirectory: string,
  reader: ProjectFileReader,
): Promise<ProjectLifecycleState> {
  if (!projectDirectory) return 'fresh';

  const project = await readJson<ProjectJsonShape>(
    reader,
    `${projectDirectory}/project.json`,
  );
  if (!project || !isConfigured(project)) return 'fresh';
  if (isAchieved(project)) return 'completed';
  return 'in_progress';
}
