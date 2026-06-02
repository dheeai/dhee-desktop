/**
 * nodeTextEdit — pure helpers for editing a node's text artifact in the
 * Inspector modal WITHOUT exposing JSON guts.
 *
 * Many nodes (shot_image_prompt, shot_motion_directive, …) store their
 * output as JSON whose meaningful text lives in a single field the
 * bundle names via `headlineField` (e.g. `imagePrompt`, `description`).
 * Showing the raw `{...}` to a user editing "the prompt" is hostile.
 *
 * - `prepareEdit` decides what the user actually edits:
 *     - md / txt  → the whole file (it's already prose).
 *     - json + a string headlineField → JUST that field's text.
 *     - json with no usable headlineField → pretty-printed JSON (raw
 *       fallback; better to show structure than nothing).
 * - `applyEdit` merges the edited text back into the canonical bytes:
 *     - text  → the new text verbatim.
 *     - json-field → the original JSON with ONLY headlineField replaced
 *       (every other field preserved).
 *     - json-raw → the edited text, validated as JSON.
 *
 * Both are pure + unit-tested; the React modal is the only IO layer.
 */

export type EditKind = 'text' | 'json-field' | 'json-raw';

export interface PreparedEdit {
  /** The string the user edits in the textarea. */
  editable: string;
  kind: EditKind;
  /** For json-field: the dot-path that `editable` came from / writes to. */
  headlineField?: string;
  /** Human label shown above the editor (e.g. "Prompt", "Raw JSON"). */
  label: string;
}

function fmtOf(outputPath: string | undefined): 'text' | 'json' | 'other' {
  if (!outputPath) return 'other';
  const l = outputPath.toLowerCase();
  if (l.endsWith('.json')) return 'json';
  if (l.endsWith('.md') || l.endsWith('.txt')) return 'text';
  return 'other';
}

export function readDotPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cur[key] = fresh;
      cur = fresh;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  cur[parts[parts.length - 1]!] = value;
}

/** Title-case a camelCase / snake field id for the editor label. */
function labelFor(field: string): string {
  const spaced = field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function prepareEdit(opts: {
  content: string;
  outputPath: string | undefined;
  headlineField?: string;
}): PreparedEdit {
  const fmt = fmtOf(opts.outputPath);
  if (fmt === 'text' || fmt === 'other') {
    return { editable: opts.content, kind: 'text', label: 'Text' };
  }
  // json
  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.content);
  } catch {
    // Unparseable JSON — let the user fix it raw.
    return { editable: opts.content, kind: 'json-raw', label: 'Raw JSON' };
  }
  if (opts.headlineField) {
    const v = readDotPath(parsed, opts.headlineField);
    if (typeof v === 'string') {
      return {
        editable: v,
        kind: 'json-field',
        headlineField: opts.headlineField,
        label: labelFor(opts.headlineField.split('.').pop() ?? opts.headlineField),
      };
    }
  }
  // No usable headline string → pretty raw JSON.
  return { editable: JSON.stringify(parsed, null, 2), kind: 'json-raw', label: 'Raw JSON' };
}

export type ApplyEditResult = { ok: true; content: string } | { ok: false; error: string };

export function applyEdit(opts: {
  original: string;
  kind: EditKind;
  headlineField?: string;
  edited: string;
}): ApplyEditResult {
  if (opts.kind === 'text') {
    return { ok: true, content: opts.edited };
  }
  if (opts.kind === 'json-raw') {
    try {
      // Validate + normalize.
      const parsed = JSON.parse(opts.edited);
      return { ok: true, content: JSON.stringify(parsed, null, 2) };
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  // json-field — merge edited text back into the ORIGINAL structure.
  if (!opts.headlineField) {
    return { ok: false, error: 'json-field edit requires a headlineField' };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(opts.original) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: `original JSON unparseable: ${e instanceof Error ? e.message : String(e)}` };
  }
  setDotPath(parsed, opts.headlineField, opts.edited);
  return { ok: true, content: JSON.stringify(parsed, null, 2) };
}

/**
 * Readable VIEW model for a node's artifact — the read-only counterpart
 * to prepareEdit. Same principle: don't dump JSON guts. For a JSON node
 * with a string headlineField we lead with that text as prose and list
 * the remaining top-level fields as supporting "details"; the raw JSON
 * is always available too (the modal exposes it behind a toggle).
 *
 *   - text/other → { kind:'text' } (already prose).
 *   - json + string headline → { kind:'json', headline, fields, raw }.
 *   - json w/o usable headline OR unparseable → { kind:'raw' }.
 */
export interface ReadableField {
  key: string;
  label: string;
  value: unknown;
}

export type ReadableView =
  | { kind: 'text'; text: string }
  | { kind: 'raw'; raw: string }
  | { kind: 'json'; headline: string; headlineLabel: string; fields: ReadableField[]; raw: string };

export function prepareReadableView(opts: {
  content: string;
  outputPath: string | undefined;
  headlineField?: string;
}): ReadableView {
  const fmt = fmtOf(opts.outputPath);
  if (fmt === 'text' || fmt === 'other') {
    return { kind: 'text', text: opts.content };
  }
  // json
  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.content);
  } catch {
    return { kind: 'raw', raw: opts.content };
  }
  const pretty = JSON.stringify(parsed, null, 2);
  const headlineVal = opts.headlineField ? readDotPath(parsed, opts.headlineField) : undefined;
  if (typeof headlineVal !== 'string' || !(parsed && typeof parsed === 'object' && !Array.isArray(parsed))) {
    return { kind: 'raw', raw: pretty };
  }
  // The top-level key the headline lives under — excluded from details so
  // we don't show the prose twice.
  const headlineTopKey = (opts.headlineField ?? '').split('.')[0];
  const fields: ReadableField[] = Object.entries(parsed as Record<string, unknown>)
    .filter(([k]) => k !== headlineTopKey)
    .map(([k, value]) => ({ key: k, label: labelFor(k), value }));
  return {
    kind: 'json',
    headline: headlineVal,
    headlineLabel: labelFor((opts.headlineField ?? '').split('.').pop() ?? opts.headlineField ?? ''),
    fields,
    raw: pretty,
  };
}
