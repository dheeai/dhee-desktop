import type { RecentProject } from '../../../shared/fileSystemTypes';

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(diff / 604800000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (weeks === 1) return 'Last week';
  return `${weeks} weeks ago`;
}

const isMac = navigator.platform.toUpperCase().includes('MAC');

export function shortenPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  if (parts.length > 3) {
    const prefix = isMac ? '~' : '...';
    return `${prefix}/${parts.slice(-3).join('/')}`;
  }
  return filePath;
}

export function getProjectNameFromPath(projectPath: string): string {
  const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const leaf = parts[parts.length - 1] || projectPath;
  return leaf.replace(/\.dhee$/i, '') || leaf;
}

export function sortRecentProjects(projects: RecentProject[]): RecentProject[] {
  return [...projects].sort((a, b) => b.lastOpened - a.lastOpened);
}

export function toFileUrl(filePath: string): string {
  // Normalize Windows separators and give a drive-letter path (C:/…) a
  // leading slash so the drive lands in the URL path, not the host:
  // `file://C:/…` parses `C:` as the host and the <img> silently fails
  // (the landing tile then falls back to the folder placeholder). With
  // the slash it becomes a valid `file:///C:/…`. Unix paths are
  // unchanged. encodeURI escapes spaces etc. without touching `:`/`/`.
  let p = filePath.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(p)) p = `/${p}`;
  return encodeURI(`file://${p}`);
}
