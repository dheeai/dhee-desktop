import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type { MediaCheckResponse } from '../shared/mediaChecks';

interface Core {
  executeProductionRequest(request: unknown): Promise<MediaCheckResponse>;
}
const coreModule = 'dhee-core/control';
export function registerMediaChecksIpc(
  ipc: {
    handle(
      channel: string,
      handler: (
        event: unknown,
        request: unknown,
      ) => Promise<MediaCheckResponse>,
    ): void;
  },
  load: () => Promise<Core> = () =>
    import(/* webpackIgnore: true */ coreModule),
) {
  ipc.handle(channels.MEDIA_CHECK, async (_event, input) => {
    try {
      if (!input || (input as { action?: unknown }).action !== 'media.check')
        throw new Error('Unknown media check operation.');
      return await (await load()).executeProductionRequest(input);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
export default registerMediaChecksIpc;
