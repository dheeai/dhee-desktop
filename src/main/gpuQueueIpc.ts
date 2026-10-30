import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type { GpuWorkflow, GpuCatalogResponse } from '../shared/gpuQueue';

interface QueueCore {
  GpuQueueClient: new (endpoint: string) => {
    listWorkflows(): Promise<GpuWorkflow[]>;
  };
}
const coreDagModule = 'dhee-core/dag';
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
    import(/* webpackIgnore: true */ coreDagModule),
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
      if (typeof core.GpuQueueClient !== 'function')
        throw new Error(
          'Build the matching Core version to connect the GPU queue.',
        );
      return {
        ok: true,
        workflows: await new core.GpuQueueClient(
          endpoint.trim(),
        ).listWorkflows(),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
export default registerGpuQueueIpc;
