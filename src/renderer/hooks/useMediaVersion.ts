/**
 * Shared cache-busting for `<img>` / `<video>` elements that reference
 * project files on disk.
 *
 * Problem: when the agent rewrites a file in-place (e.g., "make shot
 * 11's first frame the same image as shot 10's last frame" → `cp` or
 * file write), the path stored in React state doesn't change. The
 * browser's URL cache holds the previous bytes; even when the
 * component re-renders, the `<img>` element doesn't refetch. Result:
 * stale image despite the disk having the new content.
 *
 * Fix: append `?v=<version>` to every project-media URL. When the
 * surrounding file watcher fires, the parent bumps a version counter,
 * the URL changes, browser refetches.
 *
 * `MediaVersionProvider` lets a panel set the version once (usually
 * tied to its file-watcher `refreshTick`), and any descendant img/
 * video that calls `useMediaVersion()` reacts. `withMediaVersion`
 * appends the query string idempotently (handles existing `?`).
 */
import { createContext, useContext } from 'react';

const MediaVersionContext = createContext<number>(0);

export const MediaVersionProvider = MediaVersionContext.Provider;

export function useMediaVersion(): number {
  return useContext(MediaVersionContext);
}

/**
 * Append `?v=<version>` (or `&v=<version>` if the URL already has a
 * query string) so the browser treats the URL as a new resource and
 * refetches. Idempotent on empty / null / undefined inputs.
 */
export function withMediaVersion(
  src: string | null | undefined,
  version: number,
): string {
  if (!src) return src ?? '';
  const sep = src.includes('?') ? '&' : '?';
  return `${src}${sep}v=${version}`;
}
