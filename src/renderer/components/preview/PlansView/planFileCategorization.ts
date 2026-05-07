/**
 * Categorization + naming for the Content tab (formerly Files).
 *
 * The on-disk markdown layout is heterogenous (top-level files,
 * `plans/`, `chapters/<n>/scenes/<n>`, `characters/`, `settings/`),
 * but the user-facing tab should hide the directory structure and
 * group every file by the kind of thing it represents:
 *
 *   - content    — story / original input / world style
 *   - scenes     — per-scene markdown
 *   - settings   — per-setting markdown
 *   - characters — per-character markdown
 *   - other      — anything else (rare; surfaced for visibility)
 *
 * Pure: no fs, no React. Path string in, structured record out.
 */

export type PlanCategory =
  | 'content'
  | 'scenes'
  | 'settings'
  | 'characters'
  | 'other';

export interface PlanFile {
  /** Path relative to project root. */
  path: string;
  /** Human-readable name shown in the sidebar. */
  displayName: string;
  category: PlanCategory;
  /**
   * Sort key inside the category. Used so e.g. scenes sort by number
   * (Scene 2 follows Scene 1, even when Scene 12 also exists), and
   * "Story" / "Original Input" / "World Style" come out in a
   * stable order under Content.
   */
  sortKey: string | number;
}

const MD_RE = /\.md$/i;

function toTitleCase(value: string): string {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function basename(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

function slugFromMd(path: string): string {
  return basename(path).replace(MD_RE, '');
}

/**
 * Map a single markdown path to its category + display name. Caller
 * should pre-filter to `.md` paths; non-md paths return `other`
 * with a best-effort name (the helper isn't strict about extension).
 */
export function categorizePlanFile(relativePath: string): PlanFile {
  const slug = slugFromMd(relativePath);

  // Top-level "Original Input" — the user's seed prompt.
  if (relativePath === 'original_input.md') {
    return { path: relativePath, displayName: 'Original Input', category: 'content', sortKey: 1 };
  }

  // Plans folder — world style and other top-level plans.
  if (relativePath === 'plans/world_style.md') {
    return { path: relativePath, displayName: 'World Style', category: 'content', sortKey: 2 };
  }

  // Story lives under each chapter's plans/. Multiple chapters could
  // exist (Village currently has chapter_1); we treat them all as
  // "Story" for now and order by chapter number so they stay stable.
  const storyMatch = relativePath.match(/^chapters\/chapter_(\d+)\/plans\/story\.md$/);
  if (storyMatch) {
    return {
      path: relativePath,
      displayName: 'Story',
      category: 'content',
      // Sort Story BEFORE Original Input + World Style — Story is the
      // user's main editing surface; the seed input is reference.
      sortKey: 0 + parseInt(storyMatch[1] ?? '1', 10) * 0.001,
    };
  }

  // Per-scene markdown. Numbered sort so Scene 12 doesn't sort
  // before Scene 2 alphabetically.
  const sceneMatch = relativePath.match(/^chapters\/chapter_(\d+)\/scenes\/scene_(\d+)\.md$/);
  if (sceneMatch) {
    const sceneNum = parseInt(sceneMatch[2] ?? '0', 10);
    const chapterNum = parseInt(sceneMatch[1] ?? '0', 10);
    return {
      path: relativePath,
      displayName: `Scene ${sceneNum}`,
      category: 'scenes',
      // Pack chapter-major / scene-minor into a single comparable
      // number so scene 1 of chapter 2 follows scene 12 of chapter 1.
      sortKey: chapterNum * 1000 + sceneNum,
    };
  }

  if (relativePath.startsWith('settings/')) {
    const display = toTitleCase(slug);
    return { path: relativePath, displayName: display, category: 'settings', sortKey: display };
  }

  if (relativePath.startsWith('characters/')) {
    const display = toTitleCase(slug);
    return { path: relativePath, displayName: display, category: 'characters', sortKey: display };
  }

  const display = toTitleCase(slug);
  return { path: relativePath, displayName: display, category: 'other', sortKey: display };
}

export type GroupedPlanFiles = Record<PlanCategory, PlanFile[]>;

/**
 * Filter the supplied paths to `.md` files, categorize each, then
 * return a record keyed by category. Each bucket is sorted by its
 * `sortKey` (numeric for scenes/content, alphabetical for
 * settings/characters/other).
 *
 * The returned record always has all five keys; missing categories
 * are empty arrays so consumers can iterate without null checks.
 */
export function groupPlanFiles(paths: string[]): GroupedPlanFiles {
  const grouped: GroupedPlanFiles = {
    content: [],
    scenes: [],
    settings: [],
    characters: [],
    other: [],
  };

  for (const path of paths) {
    if (!MD_RE.test(path)) continue;
    const file = categorizePlanFile(path);
    grouped[file.category].push(file);
  }

  for (const cat of Object.keys(grouped) as PlanCategory[]) {
    grouped[cat].sort((a, b) => {
      if (typeof a.sortKey === 'number' && typeof b.sortKey === 'number') {
        return a.sortKey - b.sortKey;
      }
      return String(a.sortKey).localeCompare(String(b.sortKey));
    });
  }

  return grouped;
}
