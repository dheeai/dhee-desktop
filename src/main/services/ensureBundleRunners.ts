import { readFileSync, statSync } from 'fs';
import path from 'path';

import {
  defaultRunnersNodeModulesDir,
  installMissingBundleRunners,
  wireRunnersDiscoveryEnv,
} from './npmBundleInstaller';
import { BUILTIN_RUNNER_TOOLS } from '../builtinRunnerTools';

function activeRunnersNodeModulesDir(homeDir: string): string {
  const configured = process.env.DHEE_RUNNERS_DIR?.trim();
  if (configured) return path.join(configured, 'node_modules');
  return defaultRunnersNodeModulesDir(homeDir);
}

type MissingRunner = {
  tool: string;
  range: string;
  package?: string;
  install?: string;
};

type NpmRunnerLoadResult = {
  registered: string[];
  skipped: string[];
  errors: string[];
};

type DagModule = {
  parseBundleSource: (uri: string) => unknown;
  resolveBundleDir: (source: unknown) => string;
  loadBundle: (path: string) => { dependencies?: unknown };
  discoverNpmRunners: (
    reg?: unknown,
    roots?: string[],
  ) => Promise<NpmRunnerLoadResult>;
  checkBundleRunners: (bundle: Record<string, unknown>) => MissingRunner[];
  getGlobalRegistry: () => unknown;
};

function loadBundleJsonFromProject(projectDir: string, dag: DagModule): Record<string, unknown> {
  const projectJsonPath = path.join(projectDir, 'project.json');
  const project = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
    bundleSource?: string;
  };
  if (!project.bundleSource || typeof project.bundleSource !== 'string') {
    throw new Error('project.json is missing bundleSource');
  }
  const source = dag.parseBundleSource(project.bundleSource);
  const bundlePathOrDir = dag.resolveBundleDir(source);
  const bundleJsonPath = statSync(bundlePathOrDir).isDirectory()
    ? path.join(bundlePathOrDir, 'bundle.json')
    : bundlePathOrDir;
  return dag.loadBundle(bundleJsonPath) as Record<string, unknown>;
}

function formatMissingRunners(missing: MissingRunner[]): string {
  return missing
    .map((m) => {
      const pkg = m.package ? ` (${m.package})` : '';
      const install = m.install ? ` — try: ${m.install}` : '';
      return `${m.tool}${pkg} (required ${m.range})${install}`;
    })
    .join('; ');
}

function declaredRunnerPackageNames(bundleJson: Record<string, unknown>): string[] {
  const deps = bundleJson.dependencies as
    | { runnerPackages?: Record<string, string> }
    | undefined;
  const names: string[] = [];
  for (const spec of Object.values(deps?.runnerPackages ?? {})) {
    const trimmed = spec.trim();
    if (!trimmed) continue;
    // "@scope/pkg@^1" → "@scope/pkg"; "pkg@1.2" → "pkg"
    const at = trimmed.lastIndexOf('@');
    names.push(at > 0 ? trimmed.slice(0, at) : trimmed);
  }
  return names;
}

function blockingDiscoveryErrors(
  errors: string[],
  bundleJson: Record<string, unknown>,
): string[] {
  const declared = declaredRunnerPackageNames(bundleJson);
  if (declared.length === 0) return [];
  return errors.filter((e) => declared.some((pkg) => e.startsWith(`${pkg}:`)));
}

function formatDiscoveryErrors(errors: string[]): string {
  return errors.join('; ');
}

/**
 * Install npm runner packages declared by the project's bundle (when not
 * built-in), discover them from the studios runners dir, and verify every
 * declared runner is registered before the walk starts.
 */
export async function ensureProjectExternalRunners(
  projectDir: string,
  homeDir: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const runnersDir = activeRunnersNodeModulesDir(homeDir);
    wireRunnersDiscoveryEnv(homeDir);

    const dagModulePath = 'dhee-core/dag';
    const dag = (await import(/* webpackIgnore: true */ dagModulePath)) as DagModule;
    const bundleJson = loadBundleJsonFromProject(projectDir, dag);

    const { runnerErrors } = await installMissingBundleRunners({
      bundleJson,
      runnersNodeModulesDir: runnersDir,
      builtinTools: BUILTIN_RUNNER_TOOLS,
    });
    if (runnerErrors.length > 0) {
      const detail = runnerErrors
        .map((e) => `${e.tool} (${e.packageName}): ${e.error}`)
        .join('; ');
      return { ok: false, error: `Failed to install external runners: ${detail}` };
    }

    const discovery = await dag.discoverNpmRunners(dag.getGlobalRegistry(), [runnersDir]);
    const discoveryErrors = blockingDiscoveryErrors(discovery.errors, bundleJson);
    if (discoveryErrors.length > 0) {
      return {
        ok: false,
        error:
          `External runner packages failed to load from ${runnersDir}: ` +
          formatDiscoveryErrors(discoveryErrors),
      };
    }

    const missing = dag.checkBundleRunners(bundleJson);
    if (missing.length > 0) {
      const loadHints =
        discovery.errors.length > 0
          ? ` Load errors: ${formatDiscoveryErrors(discovery.errors)}.`
          : '';
      return {
        ok: false,
        error:
          `Bundle requires external runners that are not registered: ` +
          `${formatMissingRunners(missing)}.` +
          loadHints +
          ` Installed runners live under ${runnersDir} — restart Dhee after installing.`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
