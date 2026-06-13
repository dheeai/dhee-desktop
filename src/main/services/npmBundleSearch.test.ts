import { describe, expect, it, jest } from '@jest/globals';

import {
  searchNpmBundles,
  prettifyPackageName,
  type FetchLike,
} from './npmBundleSearch';

describe('prettifyPackageName', () => {
  it('strips scope + dhee-bundle-/dhee-runner- prefix and title-cases', () => {
    expect(prettifyPackageName('dhee-bundle-infographics')).toBe('Infographics');
    expect(prettifyPackageName('dhee-bundle-cartoon-explainer')).toBe(
      'Cartoon Explainer',
    );
    expect(prettifyPackageName('@dhee_ai/openrouter-documentary-pack')).toBe(
      'Openrouter Documentary Pack',
    );
    expect(prettifyPackageName('dhee-runner-tts')).toBe('Tts');
  });
});

describe('searchNpmBundles', () => {
  it('queries by the dhee-bundle keyword, maps fields, filters scaffolders', async () => {
    let calledUrl = '';
    const fetchImpl: FetchLike = jest.fn(async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          objects: [
            {
              package: {
                name: 'dhee-bundle-infographics',
                version: '0.1.0',
                description: 'Narrated infographic videos.',
              },
            },
            {
              package: { name: 'create-dhee-bundle', version: '0.1.1', description: 'scaffolder' },
            },
            {
              package: { name: 'dhee-bundle-cartoon-explainer', version: '0.2.0', description: 'Cartoon.' },
            },
          ],
        }),
      };
    });

    const res = await searchNpmBundles({
      query: 'cartoon',
      registryUrl: 'https://registry.test',
      fetchImpl,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // keyword guard + query are AND-combined into the search text
    expect(calledUrl).toContain('/-/v1/search?text=');
    expect(decodeURIComponent(calledUrl)).toContain('keywords:dhee-bundle cartoon');
    // create-* scaffolder filtered out; the two bundles mapped with derived names
    expect(res.hits.map((h) => h.name)).toEqual([
      'dhee-bundle-infographics',
      'dhee-bundle-cartoon-explainer',
    ]);
    expect(res.hits[0]).toMatchObject({
      name: 'dhee-bundle-infographics',
      displayName: 'Infographics',
      version: '0.1.0',
      spec: 'dhee-bundle-infographics',
    });
  });

  it('returns an error on a failed registry response', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => ({ ok: false, status: 500 }));
    const res = await searchNpmBundles({ registryUrl: 'https://registry.test', fetchImpl });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('500');
  });
});
