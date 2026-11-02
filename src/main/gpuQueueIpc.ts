import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type { GpuWorkflow, GpuCatalogResponse } from '../shared/gpuQueue';

interface QueueCore {
  executeProductionRequest(
    request: unknown,
  ): Promise<
    | { ok: true; result: { workflows: GpuWorkflow[] } }
    | { ok: false; error: string }
  >;
}
const coreControlModule = 'dhee-runner-production';
export function registerGpuQueueIpc(
  ipc: {
    handle(
      channel: string,
      listener: (
        event: unknown,
        request: unknown,
      ) => Promise<GpuCatalogResponse>,
    ): void;
  },
  load: () => Promise<QueueCore> = () =>
    import(/* webpackIgnore: true */ coreControlModule),
) {
  ipc.handle(channels.GPU_QUEUE_CATALOG, async (_event, request) => {
    try {
      const endpoint = (request as { endpoint?: unknown } | null)?.endpoint;
      if (
        typeof endpoint !== 'string' ||
        !endpoint.trim() ||
        endpoint.length > 2048
      )
        throw new Error('Enter the GPU queue MCP endpoint.');
      const core = await load();
      if (typeof core.executeProductionRequest !== 'function')
        throw new Error(
          'Build the matching Core version to connect the GPU queue.',
        );
      const result = await core.executeProductionRequest({
        action: 'gpu.catalog',
        endpoint: endpoint.trim(),
      });
      return result.ok
        ? { ok: true, workflows: result.result.workflows }
        : result;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
export default registerGpuQueueIpc;
