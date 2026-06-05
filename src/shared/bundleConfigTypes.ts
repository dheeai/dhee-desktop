/**
 * Shared types for the Bundle Configurator (first-run setup, community
 * install, BYO workflow). These mirror the shapes dhee-core/dag returns
 * (checkBundle / enrichBundleFit / installBundle / importWorkflow).
 * dhee-core's dist ships without .d.ts (tsup dts:false), so — like
 * ManagerModule in dheeCoreManager.ts — we hand-declare the contract
 * here and keep it in sync with src/dag/{checkBundle,bundleRequirements,
 * installBundle,importWorkflow}.ts.
 */

export type BundleFitStatus = 'ready' | 'incomplete' | 'unreachable';

export interface WorkflowModelRef {
  nodeType: string;
  nodeId: string;
  inputField: string;
  current_value: string;
}

export interface MissingNodeClass {
  nodeId: string;
  class_type: string;
}

export interface RequiredModel {
  classField: string;
  canonicalFilename: string;
  type?: string;
  downloadUrl?: string;
  sizeGb?: number;
  optional?: boolean;
}

export interface RequiredCustomNode {
  classType: string;
  pack?: string;
  installVia?: 'manager' | 'git';
  gitUrl?: string;
  note?: string;
}

/** A missing model gap, optionally annotated with the bundle's curated requirement. */
export interface EnrichedModelGap extends WorkflowModelRef {
  requirement?: RequiredModel;
}

/** A missing custom-node gap, optionally annotated with the bundle's curated requirement. */
export interface EnrichedNodeGap extends MissingNodeClass {
  requirement?: RequiredCustomNode;
}

export interface EnrichedWorkflowFit {
  workflowKey: string;
  ok: boolean;
  missing_refs: EnrichedModelGap[];
  missing_node_classes: EnrichedNodeGap[];
  /** `<class>.<field>` → available model names on the endpoint (remap candidates). */
  available_by_class: Record<string, string[]>;
  error?: string;
}

export interface EnrichedBundleFit {
  bundleDir: string;
  endpoint: string;
  status: BundleFitStatus;
  modelsMissing: number;
  nodesMissing: number;
  workflows: EnrichedWorkflowFit[];
}

/** A persisted "configured for this ComfyUI" stamp (bundle:resolution). */
export interface BundleResolution {
  bundleId: string;
  bundleVersion: string;
  endpoint: string;
  status: BundleFitStatus;
  modelsMissing: number;
  nodesMissing: number;
  resolvedAt: number;
}

/** Aliases to persist for an endpoint (bundle:resolve). */
export interface ResolvePatch {
  /** model canonical filename → installed filename. */
  name_aliases?: Record<string, string>;
  /** workflowKey → { nodeId → swapped class_type }. */
  class_swaps?: Record<string, Record<string, string>>;
}

/** Result of probing a ComfyUI endpoint (comfy:probe). */
export type ComfyProbeResult =
  | {
      ok: true;
      version?: string;
      gpuName?: string;
      vramGb?: number;
      modelCount: number;
      nodeClasses: number;
    }
  | { ok: false; error: string };
