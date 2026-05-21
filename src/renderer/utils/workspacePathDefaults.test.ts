/**
 * TDD tests for the New Project dialog's workspace-path defaults +
 * persistence. Failure modes are enumerated upfront (the user's
 * directive: "test for conditions that can go wrong, not just the
 * coded path") — every test below maps to a real human action or a
 * platform edge case the dialog must survive.
 *
 * Behavior surface:
 *   - First-ever open (no persisted choice) → default to
 *     `<home>/dhee-studios`.
 *   - Subsequent opens (after a successful create) → default to the
 *     last folder the user picked.
 *   - Persistence must survive desktop restarts AND never crash the
 *     dialog if `localStorage` is unavailable (private-browsing-style
 *     storage exceptions, quota errors, etc.).
 *   - Inputs may arrive with Windows-style backslashes, trailing
 *     slashes, padding whitespace, or null — every variant must
 *     normalize to a canonical forward-slash form with no trailing
 *     separator so downstream path joins (createFolder) don't double
 *     the separator or build `Foo//Bar`.
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  DEFAULT_WORKSPACE_FOLDER_NAME,
  WORKSPACE_PATH_STORAGE_KEY,
  buildDefaultWorkspaceFolder,
  normalizeWorkspacePath,
  readPersistedWorkspacePath,
  resolveDefaultWorkspacePath,
  writePersistedWorkspacePath,
} from './workspacePathDefaults';

function inMemoryStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    snapshot(): Record<string, string> {
      return Object.fromEntries(store);
    },
  };
}

describe('normalizeWorkspacePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizeWorkspacePath('C:\\Users\\foo\\dhee-studios')).toBe(
      'C:/Users/foo/dhee-studios',
    );
  });

  it('strips a single trailing slash', () => {
    expect(normalizeWorkspacePath('/Users/foo/dhee-studios/')).toBe(
      '/Users/foo/dhee-studios',
    );
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizeWorkspacePath('/Users/foo/dhee-studios///')).toBe(
      '/Users/foo/dhee-studios',
    );
  });

  it('leaves an already-normalized path alone', () => {
    expect(normalizeWorkspacePath('/Users/foo/dhee-studios')).toBe(
      '/Users/foo/dhee-studios',
    );
  });
});

describe('buildDefaultWorkspaceFolder', () => {
  it('returns <home>/dhee-studios when a home dir is provided', () => {
    expect(buildDefaultWorkspaceFolder('/Users/ganaraj')).toBe(
      '/Users/ganaraj/dhee-studios',
    );
  });

  it('strips a trailing slash from the home dir before joining', () => {
    expect(buildDefaultWorkspaceFolder('/Users/ganaraj/')).toBe(
      '/Users/ganaraj/dhee-studios',
    );
  });

  it('falls back to a bare folder name when home dir is missing', () => {
    expect(buildDefaultWorkspaceFolder('')).toBe(DEFAULT_WORKSPACE_FOLDER_NAME);
    expect(buildDefaultWorkspaceFolder(null)).toBe(DEFAULT_WORKSPACE_FOLDER_NAME);
    expect(buildDefaultWorkspaceFolder(undefined)).toBe(
      DEFAULT_WORKSPACE_FOLDER_NAME,
    );
  });

  it('treats a whitespace-only home dir as missing', () => {
    expect(buildDefaultWorkspaceFolder('   ')).toBe(
      DEFAULT_WORKSPACE_FOLDER_NAME,
    );
  });

  it('uses the constant for the folder name (so a rename only touches one spot)', () => {
    // Pin the spelling so a casual rename of the constant doesn't
    // silently change the user's default folder under their home dir.
    expect(DEFAULT_WORKSPACE_FOLDER_NAME).toBe('dhee-studios');
  });
});

describe('resolveDefaultWorkspacePath', () => {
  const fallback = '/Users/ganaraj/dhee-studios';

  it('returns the stored path when set and non-empty', () => {
    expect(
      resolveDefaultWorkspacePath({
        storedPath: '/Users/ganaraj/film-work',
        fallbackDefault: fallback,
      }),
    ).toBe('/Users/ganaraj/film-work');
  });

  it('normalizes the stored path before returning (forward slashes, no trailing sep)', () => {
    expect(
      resolveDefaultWorkspacePath({
        storedPath: 'C:\\Users\\ganaraj\\film-work\\',
        fallbackDefault: fallback,
      }),
    ).toBe('C:/Users/ganaraj/film-work');
  });

  it('falls back to default when stored is null (first-ever open)', () => {
    expect(
      resolveDefaultWorkspacePath({
        storedPath: null,
        fallbackDefault: fallback,
      }),
    ).toBe(fallback);
  });

  it('falls back to default when stored is undefined', () => {
    expect(
      resolveDefaultWorkspacePath({
        storedPath: undefined,
        fallbackDefault: fallback,
      }),
    ).toBe(fallback);
  });

  it('falls back to default when stored is empty', () => {
    expect(
      resolveDefaultWorkspacePath({ storedPath: '', fallbackDefault: fallback }),
    ).toBe(fallback);
  });

  it('falls back to default when stored is whitespace only', () => {
    expect(
      resolveDefaultWorkspacePath({
        storedPath: '   ',
        fallbackDefault: fallback,
      }),
    ).toBe(fallback);
  });

  it('normalizes the fallback too (so callers can pass loose strings)', () => {
    expect(
      resolveDefaultWorkspacePath({
        storedPath: null,
        fallbackDefault: '/Users/ganaraj/dhee-studios/',
      }),
    ).toBe('/Users/ganaraj/dhee-studios');
  });
});

describe('readPersistedWorkspacePath', () => {
  it('returns null when the key is absent (first-ever open)', () => {
    const storage = inMemoryStorage();
    expect(readPersistedWorkspacePath(storage)).toBeNull();
  });

  it('returns the stored path when previously persisted', () => {
    const storage = inMemoryStorage({
      [WORKSPACE_PATH_STORAGE_KEY]: '/Users/ganaraj/film-work',
    });
    expect(readPersistedWorkspacePath(storage)).toBe(
      '/Users/ganaraj/film-work',
    );
  });

  it('normalizes the stored value before returning', () => {
    const storage = inMemoryStorage({
      [WORKSPACE_PATH_STORAGE_KEY]: '/Users/ganaraj/film-work/',
    });
    expect(readPersistedWorkspacePath(storage)).toBe(
      '/Users/ganaraj/film-work',
    );
  });

  it('returns null for an empty stored value (treat as not set)', () => {
    const storage = inMemoryStorage({ [WORKSPACE_PATH_STORAGE_KEY]: '' });
    expect(readPersistedWorkspacePath(storage)).toBeNull();
  });

  it('returns null for a whitespace-only stored value', () => {
    const storage = inMemoryStorage({
      [WORKSPACE_PATH_STORAGE_KEY]: '   ',
    });
    expect(readPersistedWorkspacePath(storage)).toBeNull();
  });

  it('returns null and never throws when storage.getItem throws (private browsing)', () => {
    const storage = {
      getItem: jest.fn<(k: string) => string | null>(() => {
        throw new Error('SecurityError: storage disabled');
      }),
    };
    expect(() => readPersistedWorkspacePath(storage)).not.toThrow();
    expect(readPersistedWorkspacePath(storage)).toBeNull();
  });
});

describe('writePersistedWorkspacePath', () => {
  it('persists a path under the canonical storage key', () => {
    const storage = inMemoryStorage();
    writePersistedWorkspacePath(storage, '/Users/ganaraj/film-work');
    expect(storage.snapshot()).toEqual({
      [WORKSPACE_PATH_STORAGE_KEY]: '/Users/ganaraj/film-work',
    });
  });

  it('normalizes before writing so future reads round-trip cleanly', () => {
    const storage = inMemoryStorage();
    writePersistedWorkspacePath(storage, 'C:\\Users\\ganaraj\\film-work\\');
    expect(storage.snapshot()[WORKSPACE_PATH_STORAGE_KEY]).toBe(
      'C:/Users/ganaraj/film-work',
    );
  });

  it('does NOT persist empty / whitespace inputs (avoid storage pollution)', () => {
    const storage = inMemoryStorage();
    writePersistedWorkspacePath(storage, '');
    writePersistedWorkspacePath(storage, '   ');
    expect(storage.snapshot()).toEqual({});
  });

  it('never throws when storage.setItem throws (quota / private browsing)', () => {
    const storage = {
      setItem: jest.fn<(k: string, v: string) => void>(() => {
        throw new Error('QuotaExceededError');
      }),
    };
    expect(() =>
      writePersistedWorkspacePath(storage, '/Users/ganaraj/film-work'),
    ).not.toThrow();
  });

  it('round-trips a write/read pair', () => {
    const storage = inMemoryStorage();
    writePersistedWorkspacePath(storage, '/Users/ganaraj/film-work');
    expect(readPersistedWorkspacePath(storage)).toBe(
      '/Users/ganaraj/film-work',
    );
  });
});

describe('user-action scenarios end-to-end through the helper API', () => {
  it('first-ever open: storage empty → resolves to <home>/dhee-studios', () => {
    const storage = inMemoryStorage();
    const stored = readPersistedWorkspacePath(storage);
    const fallback = buildDefaultWorkspaceFolder('/Users/ganaraj');
    const resolved = resolveDefaultWorkspacePath({
      storedPath: stored,
      fallbackDefault: fallback,
    });
    expect(resolved).toBe('/Users/ganaraj/dhee-studios');
  });

  it('user picks a custom folder, persists it, reopens dialog: that custom folder is the new default', () => {
    const storage = inMemoryStorage();
    writePersistedWorkspacePath(storage, '/Users/ganaraj/film-work');
    const stored = readPersistedWorkspacePath(storage);
    const fallback = buildDefaultWorkspaceFolder('/Users/ganaraj');
    const resolved = resolveDefaultWorkspacePath({
      storedPath: stored,
      fallbackDefault: fallback,
    });
    expect(resolved).toBe('/Users/ganaraj/film-work');
  });

  it('localStorage broken: dialog still gets a sensible default', () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const stored = readPersistedWorkspacePath(storage);
    const fallback = buildDefaultWorkspaceFolder('/Users/ganaraj');
    const resolved = resolveDefaultWorkspacePath({
      storedPath: stored,
      fallbackDefault: fallback,
    });
    // Persistence is dead, but the default folder still resolves.
    expect(resolved).toBe('/Users/ganaraj/dhee-studios');
    // And writing doesn't throw, even though it'll silently no-op.
    expect(() =>
      writePersistedWorkspacePath(storage, '/Users/ganaraj/film-work'),
    ).not.toThrow();
  });

  it('home dir unavailable: falls back to a bare relative default — does not crash', () => {
    const storage = inMemoryStorage();
    const stored = readPersistedWorkspacePath(storage);
    const fallback = buildDefaultWorkspaceFolder(null);
    const resolved = resolveDefaultWorkspacePath({
      storedPath: stored,
      fallbackDefault: fallback,
    });
    expect(resolved).toBe(DEFAULT_WORKSPACE_FOLDER_NAME);
  });
});
