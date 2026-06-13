/**
 * Path Resolver Utility
 * Handles path resolution for assets, especially test assets in mock mode
 */

import { stripFileProtocol } from './pathNormalizer';
import {
  debugRendererDebug,
  debugRendererLog,
  debugRendererWarn,
} from './debugLogger';

/**
 * Build a file:// URL from an absolute path.
 * On Windows (C:/...) produces file:///C:/... ; on Unix (/...) produces file:///...
 */
export function toFileUrl(absolutePath: string): string {
  let normalized = absolutePath.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized)) normalized = `/${normalized}`;
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;

  const encoded = normalized
    .split('/')
    .map((segment) =>
      /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment),
    )
    .join('/');

  return `file://${encoded}`;
}

/**
 * Test asset folder names
 */
const TEST_ASSET_FOLDERS = ['test_image', 'test_video'] as const;

/**
 * Path cache to avoid redundant file system calls
 */
const pathCache = new Map<string, { resolved: string; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds cache TTL
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 500; // Base delay in ms
const MAX_TIMEOUT = 5000; // 5 seconds max timeout

/**
 * Gets the resources path where test_image and test_video are located
 * Uses IPC to get the path from main process (works in both dev and packaged)
 */
let cachedResourcesPath: string | null = null;

async function getResourcesPath(): Promise<string> {
  if (cachedResourcesPath) {
    return cachedResourcesPath;
  }

  try {
    // Use IPC to get resources path from main process
    if (
      typeof window !== 'undefined' &&
      window.electron?.project?.getResourcesPath
    ) {
      const resourcesPath = await window.electron.project.getResourcesPath();
      if (resourcesPath && resourcesPath.trim()) {
        cachedResourcesPath = resourcesPath.trim();
        return cachedResourcesPath;
      }
    }
  } catch (error) {
    debugRendererWarn(
      '[PathResolver] Failed to get resources path via IPC:',
      error,
    );
  }

  // Fallback: try environment variable
  if (typeof process !== 'undefined' && process.env.WORKSPACE_ROOT) {
    const workspaceRoot = process.env.WORKSPACE_ROOT.trim();
    if (workspaceRoot) {
      cachedResourcesPath = workspaceRoot;
      return cachedResourcesPath;
    }
  }

  // Last resort: return empty string to avoid hardcoded paths
  debugRendererWarn(
    '[PathResolver] Could not determine resources path - using fallback',
  );
  cachedResourcesPath = '';
  return cachedResourcesPath;
}

/**
 * Checks if a path is a test asset path
 */
export function isTestAssetPath(path: string): boolean {
  if (!path) return false;

  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/');
  // Check if any segment is a test asset folder
  return segments.some((segment) =>
    TEST_ASSET_FOLDERS.some((folder) => segment === folder),
  );
}

/**
 * Extracts test asset folder and filename from a path
 */
function parseTestAssetPath(
  path: string,
): { folder: string; filename: string } | null {
  const normalized = path.replace(/\\/g, '/');

  // Split into segments and find the first test folder segment
  const segments = normalized.split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (TEST_ASSET_FOLDERS.some((f) => f === segment)) {
      const folder = segment;
      const filename = segments.slice(i + 1).join('/');
      if (filename) {
        return { folder, filename };
      }
    }
  }

  return null;
}

/**
 * Resolves a test asset path to an absolute path
 * Handles both relative (../test_image/, test_image/) and absolute paths
 */
export async function resolveTestAssetPathToAbsolute(
  testAssetPath: string,
): Promise<string> {
  if (!testAssetPath) {
    debugRendererWarn('[PathResolver] Cannot resolve empty test asset path');
    return '';
  }

  // Handle file:// URLs
  if (testAssetPath.startsWith('file://')) {
    return stripFileProtocol(testAssetPath);
  }

  // If already absolute, normalize and return
  if (testAssetPath.startsWith('/') || /^[A-Za-z]:/.test(testAssetPath)) {
    return testAssetPath.replace(/\\/g, '/');
  }

  // Parse test asset path
  const parsed = parseTestAssetPath(testAssetPath);
  if (!parsed) {
    debugRendererWarn(
      `[PathResolver] Invalid test asset path format: ${testAssetPath}`,
    );
    return '';
  }

  const { folder, filename } = parsed;

  // Get resources path
  const resourcesPath = await getResourcesPath();
  if (!resourcesPath) {
    debugRendererWarn(
      '[PathResolver] Cannot resolve test asset path: resources path not available',
    );
    return '';
  }

  // Join resources path, folder, and filename
  const absolutePath = [resourcesPath, folder, filename]
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
  return absolutePath;
}

/**
 * Resolves an asset path for display
 * If it's a test asset path, resolve to absolute path in resources
 * Otherwise, construct path relative to project directory
 */
export async function resolveAssetPathForDisplay(
  assetPath: string,
  projectDirectory: string | null,
): Promise<string> {
  // If no path, return empty
  if (!assetPath || !assetPath.trim()) {
    return '';
  }
  // Normalize backslashes early for cross-platform consistency
  const trimmedPath = assetPath.trim().replace(/\\/g, '/');

  // If it's already a file:// URL, return as-is
  if (trimmedPath.startsWith('file://')) {
    return trimmedPath;
  }

  const cacheKey = `display:${trimmedPath}:${projectDirectory || ''}`;
  const cached = pathCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.resolved;
  }

  // ALWAYS resolve test asset paths to resources path in production or if detected
  // This ensures bundled assets load correctly
  if (isTestAssetPath(trimmedPath)) {
    const absolutePath = await resolveTestAssetPathToAbsolute(trimmedPath);
    if (absolutePath) {
      const result = toFileUrl(absolutePath);
      if (assetPath.endsWith('.mp4')) {
        debugRendererLog(
          `[PathResolver] Resolved test video: ${assetPath} -> ${result}`,
        );
      }
      pathCache.set(cacheKey, { resolved: result, timestamp: Date.now() });
      return result;
    }
    // If resolution failed, fall through to project directory resolution
  }

  // If assetPath is already absolute, use it directly
  if (trimmedPath.startsWith('/') || /^[A-Za-z]:/.test(trimmedPath)) {
    const result = toFileUrl(trimmedPath);
    pathCache.set(cacheKey, { resolved: result, timestamp: Date.now() });
    return result;
  }

  // Otherwise, construct path relative to project directory
  if (projectDirectory && projectDirectory.trim()) {
    const normalizedProjectDir = projectDirectory.trim().replace(/\\/g, '/');

    // Deduplicate agent/ prefix (backend on Windows may write agent/agent/...)
    let cleanedPath = trimmedPath;
    if (cleanedPath.startsWith('agent/agent/')) {
      cleanedPath = cleanedPath.slice('agent/'.length);
    }
    // Strip directory-traversal segments sometimes emitted by backend
    // e.g., agent/../../other/.dhee/agent/image-placements/img.png -> agent/image-placements/img.png
    if (cleanedPath.includes('../')) {
      const marker = '.dhee/agent/';
      const lastIdx = cleanedPath.lastIndexOf(marker);
      if (lastIdx !== -1) {
        cleanedPath = 'agent/' + cleanedPath.slice(lastIdx + marker.length);
      }
    }

    // Handle paths that already start with .dhee
    if (cleanedPath.startsWith('.dhee/')) {
      const result = toFileUrl(`${normalizedProjectDir}/${cleanedPath}`);
      pathCache.set(cacheKey, { resolved: result, timestamp: Date.now() });
      return result;
    }

    // Backend-format project assets and content live at the project root.
    if (
      cleanedPath.match(
        /^(assets|characters|settings|props|plans|scenes|content)\//,
      )
    ) {
      const result = toFileUrl(`${normalizedProjectDir}/${cleanedPath}`);
      pathCache.set(cacheKey, { resolved: result, timestamp: Date.now() });
      return result;
    }

    // Legacy agent-prefixed paths are still resolved for compatibility.
    if (cleanedPath.startsWith('agent/')) {
      const result = toFileUrl(`${normalizedProjectDir}/.dhee/${cleanedPath}`);
      pathCache.set(cacheKey, { resolved: result, timestamp: Date.now() });
      return result;
    }

    // Handle other relative paths
    const result = toFileUrl(`${normalizedProjectDir}/${cleanedPath}`);
    if (assetPath.endsWith('.mp4')) {
      debugRendererLog(
        `[PathResolver] Resolved project video: ${assetPath} -> ${result}`,
      );
    }
    pathCache.set(cacheKey, { resolved: result, timestamp: Date.now() });
    return result;
  }

  // Fallback: treat as absolute path (may fail, but better than nothing)
  debugRendererWarn(
    `[PathResolver] No project directory provided for relative path: ${trimmedPath}`,
  );
  const result = toFileUrl(trimmedPath);
  pathCache.set(cacheKey, { resolved: result, timestamp: Date.now() });
  return result;
}

/**
 * Check if a file exists (using IPC to main process)
 */
async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    if (
      typeof window !== 'undefined' &&
      window.electron?.project?.checkFileExists
    ) {
      return await window.electron.project.checkFileExists(filePath);
    }
    return true;
  } catch (error) {
    debugRendererDebug(
      `[PathResolver] File existence check failed for ${filePath}:`,
      error,
    );
    return false;
  }
}

/**
 * Resolve asset path with retry logic and file existence verification
 * Uses exponential backoff for retries
 */
export async function resolveAssetPathWithRetry(
  assetPath: string,
  projectDirectory: string | null,
  options: {
    maxRetries?: number;
    retryDelayBase?: number;
    timeout?: number;
    verifyExists?: boolean;
  } = {},
): Promise<string> {
  const {
    maxRetries = MAX_RETRIES,
    retryDelayBase = RETRY_DELAY_BASE,
    timeout = MAX_TIMEOUT,
    verifyExists = true,
  } = options;

  // Check cache first
  const cacheKey = `${assetPath}:${projectDirectory || ''}`;
  const cached = pathCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.resolved;
  }

  let lastError: Error | null = null;
  let resolvedPath = '';

  // Create timeout promise
  const timeoutPromise = new Promise<string>((_, reject) => {
    setTimeout(() => reject(new Error('Path resolution timeout')), timeout);
  });

  // Retry logic with exponential backoff
  const resolveWithRetry = async (attempt: number): Promise<string> => {
    try {
      // Resolve path
      resolvedPath = await Promise.race([
        resolveAssetPathForDisplay(assetPath, projectDirectory),
        timeoutPromise,
      ]);

      // Verify file exists if requested
      if (verifyExists && resolvedPath) {
        // Remove file:// prefix for existence check
        const filePath = resolvedPath.startsWith('file://')
          ? stripFileProtocol(resolvedPath)
          : resolvedPath;

        const exists = await checkFileExists(filePath);
        if (!exists && attempt < maxRetries) {
          // File doesn't exist yet, retry
          const delay = retryDelayBase * 2 ** attempt;
          debugRendererLog(
            `[PathResolver] File not found, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}):`,
            filePath,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return resolveWithRetry(attempt + 1);
        }
        if (!exists) {
          debugRendererWarn(
            `[PathResolver] File not found after ${maxRetries} attempts:`,
            filePath,
          );
          // Return path anyway - might be created soon
        }
      }

      // Cache successful resolution
      pathCache.set(cacheKey, {
        resolved: resolvedPath,
        timestamp: Date.now(),
      });

      return resolvedPath;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = retryDelayBase * 2 ** attempt;
        debugRendererLog(
          `[PathResolver] Resolution failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}):`,
          lastError.message,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return resolveWithRetry(attempt + 1);
      }

      // Max retries reached, return empty or last resolved path
      console.error(
        `[PathResolver] Failed to resolve path after ${maxRetries} attempts:`,
        {
          assetPath,
          error: lastError.message,
        },
      );
      return resolvedPath || '';
    }
  };

  return resolveWithRetry(0);
}

/**
 * Invalidate path cache for a specific path or all paths
 */
export function invalidatePathCache(assetPath?: string): void {
  if (assetPath) {
    // Remove specific path from cache
    for (const [key] of pathCache) {
      if (key.startsWith(assetPath)) {
        pathCache.delete(key);
      }
    }
  } else {
    // Clear all cache
    pathCache.clear();
  }
}
