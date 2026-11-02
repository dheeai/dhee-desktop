import type { GpuTarget } from './gpuQueue';

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
