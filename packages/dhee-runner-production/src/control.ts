import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { checkSceneIntent } from './sceneIntent.js';

export interface ProductionOptions {
  signal?: AbortSignal;
  log?: (message: string) => void;
}
export type ProductionResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string };
type Execute = (
  request: unknown,
  options?: ProductionOptions,
) => Promise<ProductionResponse>;
/** Add the shipped extension alongside user-installed runners, regardless of cwd. */
export function configureProductionRuntime(): void {
  const configured = process.env.DHEE_NODE_MODULES_DIRS?.trim();
  let existing: string[] = [];
  if (configured?.startsWith('[')) {
    const parsed: unknown = JSON.parse(configured);
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => typeof value !== 'string' || !value.trim())
    )
      throw new Error('Runner roots must be a JSON array of nonempty paths.');
    existing = parsed;
  } else if (configured) {
    existing = configured
      .split(',')
      .flatMap((part) =>
        /^[A-Za-z]:[\\/]/.test(part.trim())
          ? [part.trim()]
          : part.split(':').map((value) => value.trim()),
      )
      .filter(Boolean);
  } else {
    let dir = process.cwd();
    for (;;) {
      const candidate = join(dir, 'node_modules');
      if (existsSync(candidate)) existing.push(candidate);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  process.env.DHEE_NODE_MODULES_DIRS = JSON.stringify([
    ...new Set([...existing, resolve(__dirname, '../..')]),
  ]);
}
const executeEngine: Execute = async (request, options) => {
  const name = 'dhee-core/control';
  const engine = (await import(name)) as { executeProductionRequest: Execute };
  return engine.executeProductionRequest(request, options);
};
export function createDesktopProductionControl(
  execute: Execute = executeEngine,
): Execute {
  return async (request, options = {}) => {
    try {
      options.signal?.throwIfAborted();
      configureProductionRuntime();
      if (
        request &&
        typeof request === 'object' &&
        'action' in request &&
        request.action === 'scene.check'
      ) {
        const keys = Object.keys(request);
        if (keys.some((key) => !['action', 'sceneIntent'].includes(key)))
          throw new Error('Unknown scene check field.');
        return {
          ok: true,
          result: checkSceneIntent(
            (request as { sceneIntent?: unknown }).sceneIntent,
          ),
        };
      }
      return await execute(request, options);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
export const executeProductionRequest = createDesktopProductionControl();
