export interface RunnerManifestSummary {
  tool: string;
  version: string;
  credentials: string[];
  displayName?: string;
  description?: string;
  packageDir?: string;
  manifestPath?: string;
  runnerDir?: string;
}

export interface RequiredRunnerReadiness {
  tool: string;
  range: string;
  installed: boolean;
  version?: string;
  versionSatisfied: boolean;
  credentials: string[];
  missingCredentials: string[];
}

export interface BundleRunnerReadiness {
  ok: boolean;
  bundleId?: string;
  bundleSource?: string;
  requiredRunners: RequiredRunnerReadiness[];
  installedRunners: RunnerManifestSummary[];
  missingRunners: Array<{ tool: string; range: string }>;
  versionMismatches: Array<{ tool: string; range: string; version: string }>;
  requiredCredentials: string[];
  missingCredentials: string[];
  errors: string[];
}

export type BundleReadinessResponse =
  | ({ ok: true } & BundleRunnerReadiness)
  | ({ ok: false; error: string } & Partial<BundleRunnerReadiness>);
