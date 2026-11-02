import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type { AssemblyResponse } from '../shared/assembly';

interface Core {
  executeProductionRequest(request: unknown): Promise<AssemblyResponse>;
}
const coreModule = 'dhee-core/control';
export function registerAssemblyIpc(
  ipc: {
    handle(
      channel: string,
      handler: (event: unknown, request: unknown) => Promise<AssemblyResponse>,
    ): void;
  },
  load: () => Promise<Core> = () =>
    import(/* webpackIgnore: true */ coreModule),
) {
  ipc.handle(channels.ASSEMBLY, async (_event, input) => {
    try {
      if (
        !input ||
        !['assembly.targets', 'assembly.run'].includes(
          String((input as { action?: unknown }).action),
        )
      )
        throw new Error('Unknown assembly operation.');
      return await (await load()).executeProductionRequest(input);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
export default registerAssemblyIpc;
