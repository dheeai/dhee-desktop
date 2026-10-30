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

export interface GpuTarget {
  nodeId: string;
  itemId?: string;
  format: string;
  status: string;
  tool: string;
  unsupported: boolean;
  selectionId: string | null;
  selection?: Record<string, unknown>;
}
export type GpuPreparationRequest =
  | { action: 'gpu.catalog' }
  | { action: 'gpu.targets'; projectDir: string; branchId: string }
  | {
      action: 'gpu.prepare';
      projectDir: string;
      branchId: string;
      nodeId: string;
      itemId?: string;
      requestId: string;
      expectedSelectionId: string | null;
      workflow: string;
      workflowVersion: string;
      inputs: Record<string, unknown>;
      primaryOutput: number;
    };
export type GpuPreparationResponse =
  | { ok: false; error: string }
  | {
      ok: true;
      result: {
        targets?: GpuTarget[];
        branches?: { branchId: string; label?: string }[];
        workflows?: GpuWorkflow[];
        selectionId?: string;
        attemptKey?: string;
        active?: boolean;
      };
    };
