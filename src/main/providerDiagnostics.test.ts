import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { probeLlm } from './providerDiagnostics';

describe('probeLlm — API-key requirement', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockFetch(impl: () => Promise<unknown>) {
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
  }

  it('does NOT require a key for a local OpenAI-compatible base URL, even on 0.0.0.0', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await probeLlm({
      provider: 'openai',
      baseUrl: 'http://0.0.0.0:8080',
    });
    // Reachable, not the "needs an API key" rejection.
    expect(res.ok).toBe(true);
    expect(
      (global.fetch as jest.Mock).mock.calls[0][0],
    ).toBe('http://0.0.0.0:8080/v1/models');
  });

  it('reports unreachable (not a key error) when the local server is down', async () => {
    mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await probeLlm({
      provider: 'openai',
      baseUrl: 'http://0.0.0.0:8080',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/could not reach/i);
  });

  it('still requires a key for a remote cloud provider with no key', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await probeLlm({ provider: 'openai', apiKey: '' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/needs an api key/i);
  });

  it('returns Gemini model ids from the models endpoint', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash' },
          { name: 'models/gemini-2.5-pro' },
        ],
      }),
    }));
    const res = await probeLlm({ provider: 'gemini', apiKey: 'AIza-test' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    }
  });
});
