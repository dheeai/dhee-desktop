/**
 * Pure helpers for chat-panel media handling.
 *
 *   - extractToolResultFilePath(result): walk both result.details.file_path
 *     AND result.file_path (legacy/flat) so we don't lose rendering
 *     when the dhee tool puts the path under `details` (which is the
 *     dhee custom-tool convention).
 *
 *   - cacheBustMediaSrc(src, key): append `?v=<key>` to a file:// URL
 *     so the Electron renderer fetches fresh bytes after a canonical
 *     artifact is overwritten. Without this, the browser caches the
 *     first bytes it ever saw at that path and shows stale content
 *     even after a regen.
 *
 * Tested in isolation; the renderer's handleEvent / MessageRow wire
 * these in.
 */

export interface MaybeToolResult {
  content?: Array<{ type?: string; text?: string }>;
  details?: { file_path?: string; asset_type?: string; created_at?: number };
  // Legacy flat shape (some old tools / pi conventions):
  file_path?: string;
  asset_type?: string;
  created_at?: number;
}

export interface ExtractedFilePath {
  filePath: string | null;
  assetType: string | null;
  /** ms-precision timestamp from the tool's `created_at` if present;
   *  used as a cache-bust key. */
  createdAt: number | null;
}

export function extractToolResultFilePath(result: MaybeToolResult | undefined): ExtractedFilePath {
  if (!result) return { filePath: null, assetType: null, createdAt: null };
  const filePath = result.details?.file_path ?? result.file_path ?? null;
  const assetType = result.details?.asset_type ?? result.asset_type ?? null;
  const createdAt = result.details?.created_at ?? result.created_at ?? null;
  return { filePath, assetType, createdAt };
}

/**
 * Append a cache-busting query string. Accepts already-keyed URLs
 * (returns as-is) so repeated appends don't compound.
 *
 * `key` is typically the artifact's mtime or the tool's `created_at`
 * timestamp — both change when the canonical file is overwritten.
 */
export function cacheBustMediaSrc(src: string, key: number | string | null | undefined): string {
  if (!src) return src;
  if (key === null || key === undefined || key === '') return src;
  // If the URL already has a query string, don't add a second `?v=`.
  if (/[?&]v=/.test(src)) return src;
  const sep = src.includes('?') ? '&' : '?';
  return `${src}${sep}v=${encodeURIComponent(String(key))}`;
}
