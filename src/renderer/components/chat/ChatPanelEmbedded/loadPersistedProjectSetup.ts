/**
 * Read a project's persisted setup (style + duration + templateId)
 * from `project.json` on disk. Returns null when the file is
 * missing/malformed or any of the three fields are blank — that's the
 * "fresh project, show the wizard" signal.
 *
 * Mirrors the predicate the legacy ChatPanel used (loadPersistedSetupForDirectory)
 * but isolated as a pure async function so the embedded variant can
 * call it without dragging in WS bookkeeping.
 */

export interface PersistedProjectSetup {
  templateId: string;
  style: string;
  duration: number;
  autonomousMode?: boolean;
}

export interface ProjectFileReader {
  readFile: (path: string) => Promise<string | null>;
}

export async function loadPersistedProjectSetup(
  projectDirectory: string,
  reader: ProjectFileReader,
): Promise<PersistedProjectSetup | null> {
  if (!projectDirectory) return null;
  let content: string | null = null;
  try {
    content = await reader.readFile(`${projectDirectory}/project.json`);
  } catch {
    return null;
  }
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<{
    templateId: unknown;
    style: unknown;
    duration: unknown;
    targetDuration: unknown;
    autonomousMode: unknown;
  }>;
  const duration =
    typeof obj.targetDuration === 'number' ? obj.targetDuration : obj.duration;
  if (
    typeof obj.templateId !== 'string' ||
    obj.templateId.trim().length === 0 ||
    typeof obj.style !== 'string' ||
    obj.style.trim().length === 0 ||
    typeof duration !== 'number'
  ) {
    return null;
  }
  return {
    templateId: obj.templateId,
    style: obj.style,
    duration,
    autonomousMode: Boolean(obj.autonomousMode),
  };
}
