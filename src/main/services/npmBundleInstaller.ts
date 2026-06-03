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
}

export type InstallNpmBundleResult =
  | {
      ok: true;
      packageName: string;
      version: string;
      bundleId: string;
      bundleDir: string;
    }
  | { ok: false; error: string };

interface NpmPackageMetadata {
  name?: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, { version?: string; dist?: { tarball?: string } }>;
}

interface DheePackageMarker {
  type?: unknown;
  bundleId?: unknown;
  bundleDir?: unknown;
}

interface TarEntry {
  path: string;
  type: string;
  data: Buffer;
}

interface ParsedPackageSpec {
  packageName: string;
  requestedVersion?: string;
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
    const { packageName, requestedVersion } = parsePackageSpec(
      params.packageSpec,
    );
    const registry = (params.registryUrl ?? DEFAULT_REGISTRY_URL).replace(
      /\/+$/,
      '',
    );
    const metadataUrl = `${registry}/${encodeRegistryPackageName(packageName)}`;
    const metadataResp = await fetchImpl(metadataUrl);
    if (!metadataResp.ok || !metadataResp.json) {
      return {
        ok: false,
        error: `Failed to read npm metadata for ${packageName}: HTTP ${metadataResp.status}`,
      };
    }
    const metadata = (await metadataResp.json()) as NpmPackageMetadata;
    const version = resolveVersion(metadata, requestedVersion);
    const tarball = metadata.versions?.[version]?.dist?.tarball;
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
    const tarballBytes = Buffer.from(await tarResp.arrayBuffer());
    const entries = parseNpmTarball(tarballBytes);
    const packageJson = readPackageJson(entries);
    const marker = validateDheeMarker(packageJson);
    const bundleFiles = collectBundleFiles(entries, marker.bundleDir);
    const bundleJsonEntry = bundleFiles.find(
      (entry) => entry.path === 'bundle.json',
    );
    if (!bundleJsonEntry) {
      return {
        ok: false,
        error: `Package marker points to '${marker.bundleDir}', but bundle.json is missing.`,
      };
    }
    const bundleJson = JSON.parse(bundleJsonEntry.data.toString('utf8')) as {
      id?: unknown;
    };
    if (bundleJson.id !== marker.bundleId) {
      return {
        ok: false,
        error: `bundle.json id '${String(bundleJson.id)}' does not match package marker '${marker.bundleId}'.`,
      };
    }

    const targetDir = path.join(params.targetBundlesDir, marker.bundleId);
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

    return {
      ok: true,
      packageName,
      version,
      bundleId: marker.bundleId,
      bundleDir: targetDir,
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

export function parsePackageSpec(spec: string): ParsedPackageSpec {
  const trimmed = spec.trim();
  if (!trimmed) throw new Error('Package name is required.');
  if (trimmed.startsWith('@')) {
    const slash = trimmed.indexOf('/');
    if (slash < 0)
      throw new Error(`Scoped package '${trimmed}' is missing a slash.`);
    const versionAt = trimmed.indexOf('@', slash + 1);
    if (versionAt > 0) {
      return {
        packageName: trimmed.slice(0, versionAt),
        requestedVersion: trimmed.slice(versionAt + 1),
      };
    }
    return { packageName: trimmed };
  }
  const versionAt = trimmed.lastIndexOf('@');
  if (versionAt > 0) {
    return {
      packageName: trimmed.slice(0, versionAt),
      requestedVersion: trimmed.slice(versionAt + 1),
    };
  }
  return { packageName: trimmed };
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

function validateDheeMarker(packageJson: Record<string, unknown>): {
  bundleId: string;
  bundleDir: string;
} {
  const marker = (packageJson as { dhee?: DheePackageMarker }).dhee;
  if (!marker || marker.type !== 'bundle') {
    throw new Error(
      'Package is not a Dhee bundle package: package.json.dhee.type must be "bundle".',
    );
  }
  if (typeof marker.bundleId !== 'string' || !marker.bundleId.trim()) {
    throw new Error(
      'Dhee bundle package is missing package.json.dhee.bundleId.',
    );
  }
  if (typeof marker.bundleDir !== 'string' || !marker.bundleDir.trim()) {
    throw new Error(
      'Dhee bundle package is missing package.json.dhee.bundleDir.',
    );
  }
  const bundleDir = marker.bundleDir
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  if (path.isAbsolute(bundleDir) || bundleDir.split('/').includes('..')) {
    throw new Error(
      `Invalid package.json.dhee.bundleDir '${marker.bundleDir}'.`,
    );
  }
  return { bundleId: marker.bundleId, bundleDir };
}

function collectBundleFiles(
  entries: TarEntry[],
  bundleDir: string,
): TarEntry[] {
  const prefix = `${bundleDir}/`;
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
    throw new Error(`Refusing to write outside bundle directory: ${candidate}`);
  }
}
