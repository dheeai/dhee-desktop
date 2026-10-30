export interface GpuWorkflow {
  name: string;
  description: string;
  version?: string;
  available: boolean;
  status: string;
  reason?: string | null;
  est_seconds?: number;
  inputs: Record<string, Record<string, unknown>>;
}
export type GpuCatalogResponse =
  | { ok: true; workflows: GpuWorkflow[] }
  | { ok: false; error: string };

export interface QueueJobSummary {
  id: string;
  workflow: string;
  phase: 'submitting' | 'unknown' | 'tracked' | 'downloaded';
  jobId?: string;
  state?: string;
  cancelRequested?: boolean;
  error?: string;
  files?: { path: string; sha256: string; bytes: number }[];
}
export interface QueueJobsRequest {
  projectDir: string;
  action: 'list' | 'refresh' | 'cancel' | 'download';
  id?: string;
}
export type QueueJobsResponse =
  | { ok: true; jobs: QueueJobSummary[] }
  | { ok: false; error: string };
