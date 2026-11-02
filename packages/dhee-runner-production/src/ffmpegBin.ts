/**
 * Resolve the ffmpeg / ffprobe executables the runners spawn.
 *
 * This Desktop-owned extension OWNS its ffmpeg dependency (it's the thing that spawns it):
 * it ships @ffmpeg-installer/ffmpeg + @ffprobe-installer/ffprobe so it
 * works standalone (CLI / headless / tests) without assuming a system
 * ffmpeg on PATH — which doesn't exist on a clean Windows box or in a
 * macOS GUI app that didn't inherit the shell PATH.
 *
 * Resolution order:
 *   1. `dhee_FFMPEG_PATH` / `dhee_FFPROBE_PATH` env override — lets a
 *      host (the desktop) or a power user pin a specific binary.
 *   2. The bundled @*-installer binary (chmod +x if pnpm stripped execute
 *      bits). When running inside a packaged Electron app the installer path
 *      points into `app.asar` (read-only, not executable); rewrite it to the
 *      unpacked sibling.
 *   3. Bare `ffmpeg` / `ffprobe` on PATH (dev / CI fallback).
 *
 * Before this, the runners spawned a bare `'ffmpeg'` and failed with
 * `spawn ffmpeg ENOENT` in the wild.
 */
import { accessSync, chmodSync, constants } from 'node:fs';
import { createRequire } from 'node:module';

const loadDependency = createRequire(__filename);

/** Return path when executable; chmod once if needed; null when unusable. */
function ensureUsableBin(path: string): string | null {
  try {
    accessSync(path, constants.X_OK);
    return path;
  } catch {
    try {
      chmodSync(path, 0o755);
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      return null;
    }
  }
}

/** Read the `.path` from an @*-installer package, asar-corrected. null if absent. */
function installerPath(pkg: string): string | null {
  try {
    const mod = loadDependency(pkg) as { path?: unknown } | undefined;
    const raw = mod?.path;
    if (typeof raw !== 'string' || raw.length === 0) return null;
    // Packaged Electron: the binary is extracted next to the asar.
    // Guard against double-rewrite when it's already unpacked.
    if (raw.includes('app.asar') && !raw.includes('app.asar.unpacked')) {
      return raw.replace('app.asar', 'app.asar.unpacked');
    }
    return raw;
  } catch {
    return null;
  }
}

function resolve(envKey: string, pkg: string, bareFallback: string): string {
  const env = process.env[envKey];
  if (env && env.trim()) return env.trim();
  const installed = installerPath(pkg);
  if (installed) return ensureUsableBin(installed) ?? bareFallback;
  return bareFallback;
}

/** Path to the ffmpeg binary. */
export function ffmpegBin(): string {
  return resolve('dhee_FFMPEG_PATH', '@ffmpeg-installer/ffmpeg', 'ffmpeg');
}

/** Path to the ffprobe binary. */
export function ffprobeBin(): string {
  return resolve('dhee_FFPROBE_PATH', '@ffprobe-installer/ffprobe', 'ffprobe');
}
