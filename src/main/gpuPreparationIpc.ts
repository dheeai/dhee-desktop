import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type { GpuPreparationResponse } from '../shared/gpuQueue';

interface Core {
  executeProductionRequest(request: unknown): Promise<GpuPreparationResponse>;
}
const coreModule = 'dhee-core/control';
export function registerGpuPreparationIpc(
  ipc: {
    handle(
      channel: string,
      handler: (
        event: unknown,
        request: unknown,
      ) => Promise<GpuPreparationResponse>,
    ): void;
  },
  settings: () => { gpuQueueUrl?: string },
  load: () => Promise<Core> = () =>
    import(/* webpackIgnore: true */ coreModule),
) {
  ipc.handle(channels.GPU_PREPARATION, async (_event, input) => {
    try {
      const req = input as Record<string, unknown> | null;
      if (
        !req ||
        !['gpu.targets', 'gpu.catalog', 'gpu.prepare', 'gpu.run'].includes(
          String(req.action),
        )
      )
        throw new Error('Unknown preparation operation.');
      const core = await load();
      if (typeof core.executeProductionRequest !== 'function')
        throw new Error(
          'Build the matching Core version to prepare GPU scenes.',
        );
      if (req.action === 'gpu.catalog' || req.action === 'gpu.prepare') {
        const endpoint = settings().gpuQueueUrl?.trim();
        if (!endpoint)
          throw new Error('Save a GPU gateway in Settings → Workflows first.');
        return await core.executeProductionRequest({ ...req, endpoint });
      }
      return await core.executeProductionRequest(req);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export default registerGpuPreparationIpc;
