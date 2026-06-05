/**
 * Pure helpers for the comfy:probe IPC handler — parse a ComfyUI
 * /system_stats + /object_info payload into the ComfyProbeResult the
 * Bundle Configurator shows (GPU, VRAM, model count, node-class count).
 * Kept separate from main.ts so the parsing is unit-testable without
 * the network or ipcMain.
 */
import type { ComfyProbeResult } from '../shared/bundleConfigTypes';

/** Distinct model filenames (across *_name dropdown fields) + node-class count. */
export function summarizeObjectInfo(info: Record<string, unknown>): {
  modelCount: number;
  nodeClasses: number;
} {
  const models = new Set<string>();
  for (const cls of Object.values(info)) {
    const required = (cls as { input?: { required?: Record<string, unknown> } })?.input?.required;
    if (!required) continue;
    for (const [field, spec] of Object.entries(required)) {
      if (!field.endsWith('_name')) continue;
      if (Array.isArray(spec) && Array.isArray(spec[0])) {
        for (const v of spec[0] as unknown[]) if (typeof v === 'string') models.add(v);
      }
    }
  }
  return { modelCount: models.size, nodeClasses: Object.keys(info).length };
}

/** Build the success ComfyProbeResult from already-fetched payloads. */
export function buildProbeResult(
  stats: Record<string, unknown>,
  info: Record<string, unknown>,
): ComfyProbeResult {
  const devices = (stats['devices'] as Array<Record<string, unknown>> | undefined) ?? [];
  const dev0 = devices[0] ?? {};
  const vramBytes = typeof dev0['vram_total'] === 'number' ? (dev0['vram_total'] as number) : undefined;
  const system = stats['system'] as Record<string, unknown> | undefined;
  const { modelCount, nodeClasses } = summarizeObjectInfo(info);
  return {
    ok: true,
    ...(typeof system?.['comfyui_version'] === 'string' ? { version: system['comfyui_version'] as string } : {}),
    ...(typeof dev0['name'] === 'string' ? { gpuName: dev0['name'] as string } : {}),
    ...(vramBytes ? { vramGb: Math.round((vramBytes / 1e9) * 10) / 10 } : {}),
    modelCount,
    nodeClasses,
  };
}
