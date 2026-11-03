import type { GpuTarget } from './gpuQueue';

export interface AssemblyVerification {
  status:
    | 'not-configured'
    | 'not-run'
    | 'unavailable'
    | 'stale'
    | 'fail'
    | 'review';
  deliveryReady: false;
  reason?: string;
  nodeId?: string;
  reportPath?: string;
  reportSha256?: string;
  checks?: Array<{
    id: string;
    status: 'pass' | 'fail' | 'unchecked';
    detail: string;
    atSec?: number;
  }>;
}

export type AssemblyRequest =
  | { action: 'assembly.targets'; projectDir: string; branchId: string }
  | {
      action: 'assembly.run';
      projectDir: string;
      branchId: string;
      nodeId: string;
      itemId?: string;
      expectedSelectionId: string | null;
    };
export type AssemblyResponse =
  | { ok: false; error: string }
  | {
      ok: true;
      result: {
        verification?: AssemblyVerification;
        deliveryReady?: false;
        targets?: GpuTarget[];
        branches?: { branchId: string }[];
        selectedOutput?: {
          nodeId: string;
          itemId?: string;
          outputRel: string;
          outputAbs: string;
        };
        gatedAfter?: string;
        budgetExceeded?: { capUsd: number; spentUsd: number };
      };
    };
