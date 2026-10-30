import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type {
  ProductionReviewRequest,
  ReviewPolicyResponse,
  ProductionReviewState,
  RecordProductionReviewRequest,
  ProductionReviewResponse,
} from '../shared/productionReview';

interface ReviewCore {
  productionReviewsRequired?: (projectDir: string) => boolean;
  setProductionReviewsRequired?: (input: {
    projectDir: string;
    enabled: boolean;
  }) => { enabled: boolean };
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
    ) => Promise<ProductionReviewResponse | ReviewPolicyResponse>,
  ) => void;
}
const coreDagModule = 'dhee-core/dag';
export function registerProductionReviewIpc(
  ipc: IpcRegistrar,
  load: () => Promise<ReviewCore> = async () => {
    const core = await import(/* webpackIgnore: true */ coreDagModule);
    return {
      ...core,
      readProductionReview: core.readProjectProductionReview,
      recordProductionReview: core.recordProjectProductionReview,
    } as ReviewCore;
  },
) {
  const invoke = async (
    method: 'readProductionReview' | 'recordProductionReview',
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
  const policy = async (
    input: { projectDir: string; enabled?: boolean },
    write: boolean,
  ): Promise<ReviewPolicyResponse> => {
    try {
      const core = await load();
      if (!core.productionReviewsRequired || !core.setProductionReviewsRequired)
        throw new Error(
          'This Core build does not support required creative reviews.',
        );
      if (write) {
        if (typeof input.enabled !== 'boolean')
          throw new Error('An explicit review policy is required.');
        return {
          ok: true,
          ...core.setProductionReviewsRequired({
            projectDir: input.projectDir,
            enabled: input.enabled,
          }),
        };
      }
      return {
        ok: true,
        enabled: core.productionReviewsRequired(input.projectDir),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  ipc.handle(channels.READ_REVIEW_POLICY, (_event, req) => policy(req, false));
  ipc.handle(channels.SET_REVIEW_POLICY, (_event, req) => policy(req, true));
  ipc.handle(channels.READ_PRODUCTION_REVIEW, (_event, req) =>
    invoke('readProductionReview', req),
  );
  ipc.handle(channels.RECORD_PRODUCTION_REVIEW, (_event, req) =>
    invoke('recordProductionReview', req),
  );
}
export default registerProductionReviewIpc;
