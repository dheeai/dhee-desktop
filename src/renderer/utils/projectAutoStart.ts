const AUTO_START_AFTER_CREATE_KEY = 'dhee.autoStartAfterCreate.v1';
const AUTO_START_TTL_MS = 10 * 60 * 1000;

interface AutoStartPayload {
  projectDir: string;
  requestedAt: number;
}

function normalizeProjectPath(value: string | null | undefined): string | null {
  const normalized = (value ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .trim();
  return normalized || null;
}

function readPayload(): AutoStartPayload | null {
  try {
    const raw = window.sessionStorage.getItem(AUTO_START_AFTER_CREATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = parsed as Partial<AutoStartPayload>;
    if (
      typeof payload.projectDir !== 'string' ||
      typeof payload.requestedAt !== 'number'
    ) {
      return null;
    }
    return {
      projectDir: payload.projectDir,
      requestedAt: payload.requestedAt,
    };
  } catch {
    return null;
  }
}

export function markProjectForAutoStart(projectDir: string): void {
  const normalized = normalizeProjectPath(projectDir);
  if (!normalized) return;
  try {
    window.sessionStorage.setItem(
      AUTO_START_AFTER_CREATE_KEY,
      JSON.stringify({
        projectDir: normalized,
        requestedAt: Date.now(),
      } satisfies AutoStartPayload),
    );
  } catch {
    // Best-effort; the user can still press Resume.
  }
}

export function consumeProjectAutoStart(projectDir: string): boolean {
  const normalized = normalizeProjectPath(projectDir);
  if (!normalized) return false;
  const payload = readPayload();
  if (!payload) return false;

  if (Date.now() - payload.requestedAt > AUTO_START_TTL_MS) {
    try {
      window.sessionStorage.removeItem(AUTO_START_AFTER_CREATE_KEY);
    } catch {
      // ignore
    }
    return false;
  }

  if (normalizeProjectPath(payload.projectDir) !== normalized) {
    return false;
  }

  try {
    window.sessionStorage.removeItem(AUTO_START_AFTER_CREATE_KEY);
  } catch {
    // ignore
  }
  return true;
}
