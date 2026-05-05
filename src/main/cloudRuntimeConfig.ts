import fs from 'fs/promises';
import path from 'path';

export interface RuntimeConfig {
  /** Kshana website (Next.js): /auth/desktop, /api/credits/balance, etc. */
  kshanaWebsiteUrl?: string;
  /** Alias for kshanaWebsiteUrl */
  websiteUrl?: string;
  /** Authenticated proxy base URL for OpenRouter and Comfy Cloud metering. */
  kshanaProxyBaseUrl?: string;
  /** Alias for kshanaProxyBaseUrl */
  proxyBaseUrl?: string;
  /** kshana-core base URL: /api/v1/chat, /api/v1/ws/chat, /api/v1/templates, etc. */
  kshanaCoreUrl?: string;
  /** Alias for kshanaCoreUrl */
  coreUrl?: string;
  /** Legacy key for core URL from older release pipelines */
  cloudServerUrl?: string;
}

export interface RuntimeConfigSource {
  isPackaged: boolean;
  resourcesPath: string;
  dirname: string;
  env: NodeJS.ProcessEnv;
}

export async function readRuntimeConfig(
  source: RuntimeConfigSource,
): Promise<RuntimeConfig | null> {
  const candidatePaths = source.isPackaged
    ? [path.join(source.resourcesPath, 'assets', 'runtime-config.json')]
    : [path.join(source.dirname, '../../assets/runtime-config.json')];

  const configs = await Promise.all(
    candidatePaths.map(async (configPath) => {
      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw) as RuntimeConfig;
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        /* missing or invalid */
      }
      return null;
    }),
  );
  return configs.find((config): config is RuntimeConfig => Boolean(config)) ?? null;
}

export function normalizeServerUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export async function resolveKshanaWebsiteUrl(
  source: RuntimeConfigSource,
): Promise<string> {
  const fromEnv = normalizeServerUrl(source.env.KSHANA_CLOUD_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig(source);
  const fromFile = normalizeServerUrl(
    parsed?.kshanaWebsiteUrl || parsed?.websiteUrl,
  );
  if (fromFile) return fromFile;
  return 'http://localhost:3000';
}

export async function resolveKshanaProxyBaseUrl(
  source: RuntimeConfigSource,
): Promise<string> {
  const fromEnv = normalizeServerUrl(source.env.KSHANA_PROXY_BASE_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig(source);
  const fromFile = normalizeServerUrl(
    parsed?.kshanaProxyBaseUrl || parsed?.proxyBaseUrl,
  );
  if (fromFile) return fromFile;
  return resolveKshanaWebsiteUrl(source);
}

export async function resolveKshanaCoreUrl(
  source: RuntimeConfigSource,
): Promise<string | undefined> {
  const fromEnv = normalizeServerUrl(source.env.KSHANA_CORE_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig(source);
  return normalizeServerUrl(
    parsed?.kshanaCoreUrl || parsed?.coreUrl || parsed?.cloudServerUrl,
  );
}
