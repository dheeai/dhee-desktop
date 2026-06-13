/* eslint-disable compat/compat */

/**
 * Search the npm registry for published Dhee bundle packages — packages tagged
 * with the `dhee-bundle` keyword (the same opt-in guard the engine uses to
 * discover bundles). Powers the "browse published bundles" picker.
 */

export interface FetchLike {
  (url: string): Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;
}

export interface NpmBundleSearchHit {
  name: string;
  version: string;
  description: string;
  /** install spec the desktop passes to bundle:install-npm. */
  spec: string;
}

export type NpmBundleSearchResult =
  | { ok: true; hits: NpmBundleSearchHit[] }
  | { ok: false; error: string };

interface SearchParams {
  query?: string;
  registryUrl?: string;
  fetchImpl?: FetchLike;
  size?: number;
}

const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

export async function searchNpmBundles(
  params: SearchParams = {},
): Promise<NpmBundleSearchResult> {
  try {
    const fetchImpl = params.fetchImpl ?? (typeof fetch === 'function' ? (fetch as FetchLike) : undefined);
    if (!fetchImpl) return { ok: false, error: 'No fetch implementation available.' };

    const registry = (params.registryUrl ?? DEFAULT_REGISTRY_URL).replace(/\/+$/, '');
    const size = Math.min(Math.max(params.size ?? 30, 1), 100);
    // keyword guard + optional free-text query (npm AND-combines terms).
    const text = `keywords:dhee-bundle ${params.query?.trim() ?? ''}`.trim();
    const url = `${registry}/-/v1/search?text=${encodeURIComponent(text)}&size=${size}`;

    const resp = await fetchImpl(url);
    if (!resp.ok || !resp.json) {
      return { ok: false, error: `npm search failed: HTTP ${resp.status}` };
    }
    const body = (await resp.json()) as {
      objects?: Array<{ package?: { name?: string; version?: string; description?: string; keywords?: string[] } }>;
    };
    const hits: NpmBundleSearchHit[] = [];
    for (const obj of body.objects ?? []) {
      const p = obj.package;
      if (!p?.name) continue;
      // The keyword search also surfaces the scaffolder (create-dhee-bundle);
      // it's not a runnable bundle, so drop it.
      if (p.name === 'create-dhee-bundle' || p.name.startsWith('create-')) continue;
      hits.push({
        name: p.name,
        version: p.version ?? 'latest',
        description: p.description ?? '',
        spec: p.name,
      });
    }
    return { ok: true, hits };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
