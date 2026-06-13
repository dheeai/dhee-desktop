/* eslint-disable compat/compat, no-use-before-define */

import path from 'path';
import { gunzipSync } from 'zlib';
import { promises as fs } from 'fs';

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export interface FetchLike {
  (url: string): Promise<FetchLikeResponse>;
}

export interface InstallNpmBundleParams {
  packageSpec: string;
  targetBundlesDir: string;
  registryUrl?: string;
  fetchImpl?: FetchLike;
  /**
   * Where to install external runner packages (and their dep tree) so the
   * engine's `discoverNpmRunners` can find them. A `node_modules` dir the
   * desktop also points `DHEE_NODE_MODULES_DIRS` at. When omitted, the bundle's
   * runner dependencies are reported but not installed.
   */
  runnersNodeModulesDir?: string;
  /**
   * Tool ids already provided by the engine (built-in runners). Any tool in the
   * bundle's `runnerPackages` NOT in this set is treated as external and pulled.
   */
  builtinTools?: readonly string[];
}

export interface InstalledRunner {
  tool: string;
  packageName: string;
  version: string;
}

export type InstallNpmBundleResult =
  | {
      ok: true;
      packageName: string;
      version: string;
      bundleId: string;
      bundleDir: string;
      /** External runner packages pulled for this bundle (empty if none). */
      installedRunners: InstalledRunner[];
      /** Runner packages that failed to install (tool → error). */
      runnerErrors: Array<{ tool: string; packageName: string; error: string }>;
    }
  | { ok: false; error: string };

interface NpmPackageMetadata {
  name?: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<
    string,
    {
      version?: string;
      dist?: { tarball?: string };
      dependencies?: Record<string, string>;
    }
  >;
}

interface DheePackageMarker {
  type?: unknown;
  bundleId?: unknown;
  bundleDir?: unknown;
  bundles?: unknown;
}

interface TarEntry {
  path: string;
  type: string;
  data: Buffer;
}

interface ParsedPackageSpec {
  packageName: string;
  requestedVersion?: string;
  /** `pkg#bundleId` — which bundle inside a multi-bundle package to install. */
  requestedBundleId?: string;
}

type EnvLike = Record<string, string | undefined>;

const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

export function defaultUserBundlesDir(
  homeDir: string,
  env: EnvLike = process.env,
): string {
  const configured = env.DHEE_USER_BUNDLES_DIR?.trim();
  if (configured) return configured;
  return path.join(homeDir, 'dhee-studios', 'bundles');
}

/**
 * Where external runner packages are installed. The desktop also points
 * `DHEE_NODE_MODULES_DIRS` at this exact `node_modules` so the engine discovers
 * them. Honors `DHEE_RUNNERS_DIR` for tests/non-standard layouts.
 */
export function defaultRunnersNodeModulesDir(
  homeDir: string,
  env: EnvLike = process.env,
): string {
  const configured = env.DHEE_RUNNERS_DIR?.trim();
  const base = configured || path.join(homeDir, 'dhee-studios', 'runners');
  return path.join(base, 'node_modules');
}

export async function installDheeBundleFromNpm(
  params: InstallNpmBundleParams,
): Promise<InstallNpmBundleResult> {
  try {
    const fetchImpl = params.fetchImpl ?? getRuntimeFetch();
    if (!fetchImpl) {
      return {
        ok: false,
        error: 'No fetch implementation is available in this runtime.',
      };
    }
    const registry = (params.registryUrl ?? DEFAULT_REGISTRY_URL).replace(
      /\/+$/,
      '',
    );
    const { packageName, requestedVersion, requestedBundleId } =
      parsePackageSpec(params.packageSpec);

    const dl = await downloadPackage(
      fetchImpl,
      registry,
      packageName,
      requestedVersion,
    );
    if (!dl.ok) return { ok: false, error: dl.error };
    const { version, entries, packageJson } = dl;

    // Resolve which bundle dir inside the package to install — supporting BOTH
    // the legacy `dhee.type:'bundle'` marker AND the standard `dhee-bundle`
    // keyword + `dhee.bundles` entry convention (what the engine discovers).
    const resolved = resolveBundleInPackage(
      packageJson,
      entries,
      requestedBundleId,
    );
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const { bundleId, bundleDir, bundleJson } = resolved;

    const bundleFiles = collectBundleFiles(entries, bundleDir);
    if (!bundleFiles.some((e) => e.path === 'bundle.json')) {
      return {
        ok: false,
        error: `Resolved bundle dir '${bundleDir}' has no bundle.json.`,
      };
    }

    const targetDir = path.join(params.targetBundlesDir, bundleId);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });
    await Promise.all(
      bundleFiles.map(async (entry) => {
        const dest = path.join(targetDir, entry.path);
        assertInside(targetDir, dest);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, entry.data);
      }),
    );

    // ── Pull external runner packages the bundle declares ──
    const installedRunners: InstalledRunner[] = [];
    const runnerErrors: Array<{ tool: string; packageName: string; error: string }> =
      [];
    const runnerPackages = extractRunnerPackages(bundleJson);
    if (runnerPackages.length > 0 && params.runnersNodeModulesDir) {
      const builtins = new Set(params.builtinTools ?? []);
      const installedNames = new Set<string>();
      for (const { tool, packageName: runnerPkg } of runnerPackages) {
        if (builtins.has(tool)) continue; // engine provides it already
        const r = await installNpmPackageTree(
          fetchImpl,
          registry,
          runnerPkg,
          params.runnersNodeModulesDir,
          installedNames,
        );
        if (r.ok) {
          installedRunners.push({ tool, packageName: runnerPkg, version: r.version });
        } else {
          runnerErrors.push({ tool, packageName: runnerPkg, error: r.error });
        }
      }
    }

    return {
      ok: true,
      packageName,
      version,
      bundleId,
      bundleDir: targetDir,
      installedRunners,
      runnerErrors,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getRuntimeFetch(): FetchLike | undefined {
  return typeof fetch === 'function' ? fetch : undefined;
}

/** Fetch + extract a single npm package's tarball (no deps). */
async function downloadPackage(
  fetchImpl: FetchLike,
  registry: string,
  packageName: string,
  requestedVersion: string | undefined,
): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      version: string;
      entries: TarEntry[];
      packageJson: Record<string, unknown>;
      meta: NpmPackageMetadata;
    }
> {
  const metadataUrl = `${registry}/${encodeRegistryPackageName(packageName)}`;
  const metadataResp = await fetchImpl(metadataUrl);
  if (!metadataResp.ok || !metadataResp.json) {
    return {
      ok: false,
      error: `Failed to read npm metadata for ${packageName}: HTTP ${metadataResp.status}`,
    };
  }
  const meta = (await metadataResp.json()) as NpmPackageMetadata;
  const version = resolveVersion(meta, requestedVersion);
  const tarball = meta.versions?.[version]?.dist?.tarball;
  if (!tarball) {
    return {
      ok: false,
      error: `npm package ${packageName}@${version} has no dist.tarball.`,
    };
  }
  const tarResp = await fetchImpl(tarball);
  if (!tarResp.ok || !tarResp.arrayBuffer) {
    return {
      ok: false,
      error: `Failed to download ${packageName}@${version}: HTTP ${tarResp.status}`,
    };
  }
  const entries = parseNpmTarball(Buffer.from(await tarResp.arrayBuffer()));
  const packageJson = readPackageJson(entries);
  return { ok: true, version, entries, packageJson, meta };
}

/**
 * Install an npm package AND its dependency tree into a `node_modules` dir by
 * fetching tarballs directly (no `npm` binary needed — works in packaged apps).
 * Published runner packages ship built `dist`, so no build step is required.
 */
async function installNpmPackageTree(
  fetchImpl: FetchLike,
  registry: string,
  packageName: string,
  nodeModulesDir: string,
  installed: Set<string>,
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  if (installed.has(packageName)) return { ok: true, version: 'cached' };
  installed.add(packageName);
  let dl;
  try {
    dl = await downloadPackage(fetchImpl, registry, packageName, undefined);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!dl.ok) return dl;

  const dest = path.join(nodeModulesDir, ...packageName.split('/'));
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await Promise.all(
    dl.entries.map(async (entry) => {
      const out = path.join(dest, entry.path);
      assertInside(dest, out);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, entry.data);
    }),
  );

  // Recurse into runtime dependencies (shallow for runner packages — typically
  // just @dheeai/runner-sdk, which itself has no runtime deps).
  const deps =
    (dl.meta.versions?.[dl.version]?.dependencies as
      | Record<string, string>
      | undefined) ??
    ((dl.packageJson as { dependencies?: Record<string, string> })
      .dependencies ||
      {});
  for (const depName of Object.keys(deps)) {
    const depResult = await installNpmPackageTree(
      fetchImpl,
      registry,
      depName,
      nodeModulesDir,
      installed,
    );
    if (!depResult.ok) return depResult;
  }
  return { ok: true, version: dl.version };
}

/** Pull `dependencies.runnerPackages` (tool → npm package) out of a bundle.json. */
function extractRunnerPackages(
  bundleJson: Record<string, unknown>,
): Array<{ tool: string; packageName: string }> {
  const deps = bundleJson.dependencies as
    | { runnerPackages?: Record<string, unknown> }
    | undefined;
  const map = deps?.runnerPackages;
  if (!map || typeof map !== 'object') return [];
  const out: Array<{ tool: string; packageName: string }> = [];
  for (const [tool, pkg] of Object.entries(map)) {
    if (typeof pkg === 'string' && pkg.trim()) {
      out.push({ tool, packageName: pkg.trim() });
    }
  }
  return out;
}

/**
 * Resolve which bundle inside the downloaded package to install.
 *  - Legacy marker: `dhee.type==='bundle'` + `dhee.bundleId` + `dhee.bundleDir`.
 *  - Standard marker: keyword `dhee-bundle` + `dhee.bundles` entry (a dir holding
 *    `bundle.json`, or a dir of per-bundle subdirs). `requestedBundleId`
 *    disambiguates multi-bundle packages.
 */
function resolveBundleInPackage(
  packageJson: Record<string, unknown>,
  entries: TarEntry[],
  requestedBundleId: string | undefined,
):
  | { ok: true; bundleId: string; bundleDir: string; bundleJson: Record<string, unknown> }
  | { ok: false; error: string } {
  const marker = (packageJson as { dhee?: DheePackageMarker }).dhee;

  // Legacy explicit marker.
  if (marker && marker.type === 'bundle') {
    if (typeof marker.bundleId !== 'string' || !marker.bundleId.trim()) {
      return { ok: false, error: 'Dhee bundle package is missing package.json.dhee.bundleId.' };
    }
    if (typeof marker.bundleDir !== 'string' || !marker.bundleDir.trim()) {
      return { ok: false, error: 'Dhee bundle package is missing package.json.dhee.bundleDir.' };
    }
    const bundleDir = normalizeRel(marker.bundleDir);
    const bundleJson = readBundleJson(entries, bundleDir);
    if (!bundleJson) {
      return { ok: false, error: `Package marker points to '${bundleDir}', but bundle.json is missing.` };
    }
    if (bundleJson.id !== marker.bundleId) {
      return {
        ok: false,
        error: `bundle.json id '${String(bundleJson.id)}' does not match package marker '${String(marker.bundleId)}'.`,
      };
    }
    return { ok: true, bundleId: marker.bundleId, bundleDir, bundleJson };
  }

  // Standard convention: keyword + dhee.bundles.
  const keywords = Array.isArray(packageJson.keywords) ? packageJson.keywords : [];
  if (!keywords.includes('dhee-bundle')) {
    return {
      ok: false,
      error:
        "Package is not a Dhee bundle: needs keyword 'dhee-bundle' (or legacy package.json.dhee.type==='bundle').",
    };
  }
  if (!marker || typeof marker.bundles !== 'string' || !marker.bundles.trim()) {
    return { ok: false, error: "Dhee bundle package is missing package.json.dhee.bundles." };
  }
  const base = normalizeRel(marker.bundles);

  // Single-bundle layout: bundle.json directly inside `base`.
  const direct = readBundleJson(entries, base);
  if (direct && typeof direct.id === 'string') {
    return { ok: true, bundleId: direct.id, bundleDir: base, bundleJson: direct };
  }

  // Multi-bundle layout: one subdir per bundle.
  const subBundles = listSubBundles(entries, base);
  if (subBundles.length === 0) {
    return { ok: false, error: `No bundle.json found under '${base}' in the package.` };
  }
  let chosen = subBundles[0]!;
  if (requestedBundleId) {
    const match = subBundles.find((b) => b.id === requestedBundleId);
    if (!match) {
      return {
        ok: false,
        error: `Package has no bundle '${requestedBundleId}'. Available: ${subBundles.map((b) => b.id).join(', ')}.`,
      };
    }
    chosen = match;
  } else if (subBundles.length > 1) {
    return {
      ok: false,
      error: `Package contains multiple bundles (${subBundles.map((b) => b.id).join(', ')}); specify one as 'pkg#bundleId'.`,
    };
  }
  return { ok: true, bundleId: chosen.id, bundleDir: chosen.dir, bundleJson: chosen.json };
}

function readBundleJson(
  entries: TarEntry[],
  bundleDir: string,
): Record<string, unknown> | null {
  const wanted = bundleDir ? `${bundleDir}/bundle.json` : 'bundle.json';
  const entry = entries.find((e) => e.path === wanted);
  if (!entry) return null;
  try {
    return JSON.parse(entry.data.toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function listSubBundles(
  entries: TarEntry[],
  base: string,
): Array<{ id: string; dir: string; json: Record<string, unknown> }> {
  const prefix = base ? `${base}/` : '';
  const out: Array<{ id: string; dir: string; json: Record<string, unknown> }> = [];
  for (const e of entries) {
    if (!e.path.startsWith(prefix) || !e.path.endsWith('/bundle.json')) continue;
    const rest = e.path.slice(prefix.length);
    if (rest.split('/').length !== 2) continue; // exactly <sub>/bundle.json
    const dir = e.path.slice(0, -'/bundle.json'.length);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(e.data.toString('utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof json.id === 'string') out.push({ id: json.id, dir, json });
  }
  return out;
}

function normalizeRel(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (path.isAbsolute(norm) || norm.split('/').includes('..')) {
    throw new Error(`Invalid package path '${p}'.`);
  }
  return norm;
}

export function parsePackageSpec(spec: string): ParsedPackageSpec {
  let trimmed = spec.trim();
  if (!trimmed) throw new Error('Package name is required.');
  let requestedBundleId: string | undefined;
  const hash = trimmed.indexOf('#');
  if (hash >= 0) {
    requestedBundleId = trimmed.slice(hash + 1).trim() || undefined;
    trimmed = trimmed.slice(0, hash).trim();
  }
  if (trimmed.startsWith('@')) {
    const slash = trimmed.indexOf('/');
    if (slash < 0)
      throw new Error(`Scoped package '${trimmed}' is missing a slash.`);
    const versionAt = trimmed.indexOf('@', slash + 1);
    if (versionAt > 0) {
      return {
        packageName: trimmed.slice(0, versionAt),
        requestedVersion: trimmed.slice(versionAt + 1),
        requestedBundleId,
      };
    }
    return { packageName: trimmed, requestedBundleId };
  }
  const versionAt = trimmed.lastIndexOf('@');
  if (versionAt > 0) {
    return {
      packageName: trimmed.slice(0, versionAt),
      requestedVersion: trimmed.slice(versionAt + 1),
      requestedBundleId,
    };
  }
  return { packageName: trimmed, requestedBundleId };
}

function encodeRegistryPackageName(packageName: string): string {
  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.split('/');
    if (!scope || !name)
      throw new Error(`Invalid scoped package name '${packageName}'.`);
    return `${scope}%2f${encodeURIComponent(name)}`;
  }
  return encodeURIComponent(packageName);
}

function resolveVersion(
  metadata: NpmPackageMetadata,
  requestedVersion?: string,
): string {
  const versions = metadata.versions ?? {};
  const wanted = requestedVersion?.trim();
  if (wanted && versions[wanted]) return wanted;
  if (wanted && metadata['dist-tags']?.[wanted])
    return metadata['dist-tags'][wanted]!;
  if (wanted) {
    throw new Error(
      `Version or dist-tag '${wanted}' was not found for ${metadata.name ?? 'package'}.`,
    );
  }
  const latest = metadata['dist-tags']?.latest;
  if (latest && versions[latest]) return latest;
  const all = Object.keys(versions);
  if (all.length > 0) return all[all.length - 1]!;
  throw new Error(`No versions found for ${metadata.name ?? 'package'}.`);
}

export function parseNpmTarball(bytes: Buffer): TarEntry[] {
  const tar =
    bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(readTarString(header, 124, 12).trim() || '0', 8);
    const type = readTarString(header, 156, 1) || '0';
    offset += 512;
    const data = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === '0' || type === '') {
      entries.push({
        path: stripNpmPackagePrefix(fullPath),
        type,
        data: Buffer.from(data),
      });
    }
  }
  return entries.filter((entry) => entry.path.length > 0);
}

function readTarString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  const end = nul >= 0 ? nul : slice.length;
  return slice.subarray(0, end).toString('utf8').trim();
}

function stripNpmPackagePrefix(p: string): string {
  return p.replace(/^package\//, '');
}

function readPackageJson(entries: TarEntry[]): Record<string, unknown> {
  const entry = entries.find((candidate) => candidate.path === 'package.json');
  if (!entry) throw new Error('npm tarball does not contain package.json.');
  return JSON.parse(entry.data.toString('utf8')) as Record<string, unknown>;
}

function collectBundleFiles(
  entries: TarEntry[],
  bundleDir: string,
): TarEntry[] {
  const prefix = bundleDir ? `${bundleDir}/` : '';
  return entries
    .filter((entry) => entry.path.startsWith(prefix))
    .map((entry) => ({
      ...entry,
      path: entry.path.slice(prefix.length),
    }))
    .filter(
      (entry) => entry.path.length > 0 && !entry.path.split('/').includes('..'),
    );
}

function assertInside(root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to write outside target directory: ${candidate}`);
  }
}
