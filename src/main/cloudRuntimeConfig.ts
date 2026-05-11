/// <reference types="node" />

import fs from 'node:fs/promises';
import path from 'node:path';

export interface RuntimeConfig {
  /** Dhee website (Next.js): /auth/desktop, /api/credits/balance, etc. */
  dheeWebsiteUrl?: string;
  /** Legacy key from older packaged builds */
  dheeWebsiteUrl?: string;
  /** Generic alias */
  websiteUrl?: string;
  /** Authenticated proxy base URL for OpenRouter and Comfy Cloud metering. */
  dheeProxyBaseUrl?: string;
  /** Alias for dheeProxyBaseUrl */
  proxyBaseUrl?: string;
  /** dhee-core base URL: /api/v1/chat, /api/v1/ws/chat, /api/v1/templates, etc. */
  dheeCoreUrl?: string;
  /** Alias for dheeCoreUrl */
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

export async function resolvedheeWebsiteUrl(
  source: RuntimeConfigSource,
): Promise<string> {
  const fromEnv = normalizeServerUrl(source.env.dhee_CLOUD_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig(source);
  const fromFile = normalizeServerUrl(
    parsed?.dheeWebsiteUrl ||
      parsed?.dheeWebsiteUrl ||
      parsed?.websiteUrl,
  );
  if (fromFile) return fromFile;
  return 'http://localhost:3000';
}

export async function resolvedheeProxyBaseUrl(
  source: RuntimeConfigSource,
): Promise<string> {
  const fromEnv = normalizeServerUrl(source.env.dhee_PROXY_BASE_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig(source);
  const fromFile = normalizeServerUrl(
    parsed?.dheeProxyBaseUrl || parsed?.proxyBaseUrl,
  );
  if (fromFile) return fromFile;
  return resolvedheeWebsiteUrl(source);
}

export async function resolvedheeCoreUrl(
  source: RuntimeConfigSource,
): Promise<string | undefined> {
  const fromEnv = normalizeServerUrl(source.env.dhee_CORE_URL);
  if (fromEnv) return fromEnv;
  const parsed = await readRuntimeConfig(source);
  return normalizeServerUrl(
    parsed?.dheeCoreUrl || parsed?.coreUrl || parsed?.cloudServerUrl,
  );
}
