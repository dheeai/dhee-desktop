import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type {
  ProductionReviewRequest,
  ProductionReviewState,
  RecordProductionReviewRequest,
  ProductionReviewResponse,
} from '../shared/productionReview';

interface ReviewCore {
  readProductionReview: (
    input: ProductionReviewRequest,
  ) => Promise<ProductionReviewState>;
  recordProductionReview: (
    input: RecordProductionReviewRequest,
  ) => Promise<ProductionReviewState>;
}
interface IpcRegistrar {
  handle: (
    channel: string,
    listener: (
      event: unknown,
      request: any,
    ) => Promise<ProductionReviewResponse>,
  ) => void;
}
const coreDagModule = 'dhee-core/dag';
export function registerProductionReviewIpc(
  ipc: IpcRegistrar,
  load: () => Promise<ReviewCore> = async () =>
    import(
      /* webpackIgnore: true */ coreDagModule
    ) as unknown as Promise<ReviewCore>,
) {
  const invoke = async (
    method: keyof ReviewCore,
    input: RecordProductionReviewRequest,
  ): Promise<ProductionReviewResponse> => {
    try {
      const core = await load();
      if (typeof core[method] !== 'function')
        return {
          ok: false,
          error:
            'This Core build does not support saved reviews. Build the matching local Core version.',
        };
      return { ok: true, review: await core[method](input) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  ipc.handle(channels.READ_PRODUCTION_REVIEW, (_event, req) =>
    invoke('readProductionReview', req),
  );
  ipc.handle(channels.RECORD_PRODUCTION_REVIEW, (_event, req) =>
    invoke('recordProductionReview', req),
  );
}
export default registerProductionReviewIpc;
