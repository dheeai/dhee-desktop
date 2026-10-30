/** IPC contract for artifact-snapshot decisions; execution gates are separate. */
export interface ProductionReviewTarget {
  nodeId: string;
  itemId?: string;
}
export interface ProductionReviewRequest {
  projectDir: string;
  gate: 'storyboard' | 'references' | 'rough-cut';
  targets: ProductionReviewTarget[];
}
export interface ProductionReviewPreview {
  key: string;
  versionId: string;
  previewPath: string;
  format: 'text' | 'md' | 'json' | 'image' | 'video' | 'audio';
}
export interface ProductionReviewState {
  authoritative?: boolean;
  previews?: ProductionReviewPreview[];
  status:
    | 'approved'
    | 'changes-requested'
    | 'unreviewed'
    | 'stale'
    | 'unavailable';
  fingerprint?: string;
  reason?: string;
  decidedAt?: number;
  notes?: string;
}
export interface RecordProductionReviewRequest extends ProductionReviewRequest {
  expectedFingerprint: string;
  decision: 'approved' | 'changes-requested';
  notes?: string;
}
export type ProductionReviewResponse =
  | { ok: true; review: ProductionReviewState }
  | { ok: false; error: string };

export type ReviewPolicyResponse = {ok:true;enabled:boolean} | {ok:false;error:string};
