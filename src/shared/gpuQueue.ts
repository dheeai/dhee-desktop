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
