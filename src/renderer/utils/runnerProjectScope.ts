import type { RunnerStatusResponse } from '../../shared/dheeIpc';

export function normalizeRunnerProjectPath(
  projectDirectory: string | null | undefined,
): string | null {
  const normalized = (projectDirectory ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .trim();
  return normalized || null;
}

function normalizeProjectName(
  projectName: string | null | undefined,
): string | null {
  const normalized = (projectName ?? '')
    .replace(/\.dhee$/i, '')
    .trim()
    .toLowerCase();
  return normalized || null;
}

export function runnerBelongsToProject(
  status:
    | Pick<RunnerStatusResponse, 'active' | 'projectDir' | 'projectName'>
    | null
    | undefined,
  project: {
    projectDirectory: string | null | undefined;
    projectName: string | null | undefined;
  },
): boolean {
  if (!status?.active) return false;

  const runnerProjectDir = normalizeRunnerProjectPath(status.projectDir);
  const currentProjectDir = normalizeRunnerProjectPath(
    project.projectDirectory,
  );
  if (runnerProjectDir) {
    return !!currentProjectDir && runnerProjectDir === currentProjectDir;
  }

  const runnerProjectName = normalizeProjectName(status.projectName);
  const currentProjectName =
    normalizeProjectName(project.projectName) ||
    normalizeProjectName(currentProjectDir?.split('/').pop());
  return !!runnerProjectName && runnerProjectName === currentProjectName;
}
