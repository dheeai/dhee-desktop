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
  media?: {
    durationSec?: number;
    video?: { width: number; height: number; fps: number | null };
    audio?: {
      channels: number;
      sampleRate: number;
      peakDb?: number | null;
      meanDb?: number | null;
    };
    silenceIntervals?: { start: number; end?: number }[];
  };
  manualChecks: string[];
  creativeApproval: 'required';
}
export type MediaCheckResponse =
  | { ok: true; result: MediaCheckReport }
  | { ok: false; error: string };
