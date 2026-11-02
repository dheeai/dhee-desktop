export interface MediaCheckRequest {
  action: 'media.check';
  projectDir: string;
  branchId: string;
  nodeId: string;
  itemId?: string;
  expectedAudio: boolean;
  expectedDurationSec?: number;
}
export interface MediaCheckReport {
  checkedAt: string;
  source: {
    versionId: string;
    outputPath: string;
    sha256: string;
    bytes: number;
  };
  technicalStatus: 'issues' | 'unavailable' | 'review' | 'passed';
  checks: { code: string; status: string; message: string }[];
  manualChecks: string[];
  creativeApproval: 'required';
}
export type MediaCheckResponse =
  | { ok: true; result: MediaCheckReport }
  | { ok: false; error: string };
