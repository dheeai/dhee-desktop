/**
 * Inject Dhee Cloud Comfy auth for fetch calls that omit Authorization.
 * Defense-in-depth for npm runners still on pre-SDK ComfyClient versions.
 */

const COMFY_CLOUD_HOST = 'cloud.comfy.org';

let installed = false;
let originalFetch: typeof globalThis.fetch | undefined;

function isComfyCloudHost(hostname: string): boolean {
  return hostname.toLowerCase() === COMFY_CLOUD_HOST;
}

function collectComfyBaseUrls(): string[] {
  const urls = new Set<string>();
  const add = (raw: string | undefined) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    try {
      const u = new URL(raw.trim());
      urls.add(`${u.origin}${u.pathname.replace(/\/$/, '')}`);
    } catch {
      // ignore invalid URL
    }
  };
  add(process.env.COMFYUI_BASE_URL);
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('ENDPOINT_')) add(value);
  }
  return [...urls];
}

function urlMatchesComfyEndpoint(requestUrl: string, bases: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }
  if (isComfyCloudHost(parsed.hostname)) return true;
  const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  return bases.some((base) => normalized === base || normalized.startsWith(`${base}/`));
}

function mergeAuthHeaders(init: RequestInit | undefined, auth: Record<string, string>): RequestInit {
  const headers = new Headers(init?.headers);
  if (headers.has('Authorization') || headers.has('X-API-Key')) {
    return init ?? {};
  }
  for (const [k, v] of Object.entries(auth)) headers.set(k, v);
  return { ...init, headers };
}

function authForUrl(requestUrl: string): Record<string, string> {
  const key = process.env.COMFY_CLOUD_API_KEY?.trim();
  if (!key) return {};
  let hostname: string;
  try {
    hostname = new URL(requestUrl).hostname;
  } catch {
    return {};
  }
  if (isComfyCloudHost(hostname)) {
    return { 'X-API-Key': key };
  }
  return { Authorization: `Bearer ${key}` };
}

export function installComfyCloudFetchAuth(): void {
  if (installed) return;
  originalFetch = globalThis.fetch.bind(globalThis);
  installed = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const mode = (process.env.COMFY_MODE ?? 'local').trim();
    const bases = collectComfyBaseUrls();
    const needsAuth =
      mode === 'cloud' &&
      !!process.env.COMFY_CLOUD_API_KEY?.trim() &&
      urlMatchesComfyEndpoint(requestUrl, bases);

    if (!needsAuth) {
      return originalFetch!(input, init);
    }

    const auth = authForUrl(requestUrl);
    if (Object.keys(auth).length === 0) {
      return originalFetch!(input, init);
    }

    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch!(input, mergeAuthHeaders(init, auth));
    }

    const req = input as Request;
    if (req.headers.has('Authorization') || req.headers.has('X-API-Key')) {
      return originalFetch!(input, init);
    }
    const headers = new Headers(req.headers);
    for (const [k, v] of Object.entries(auth)) headers.set(k, v);
    const patched = new Request(req, { headers });
    return originalFetch!(patched, init);
  }) as typeof fetch;
}

export function uninstallComfyCloudFetchAuthForTesting(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
  installed = false;
  originalFetch = undefined;
}

export function __isComfyCloudFetchAuthInstalledForTesting(): boolean {
  return installed;
}
