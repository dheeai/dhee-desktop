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

  it('does NOT require a key for the local OpenAI-compatible (lmstudio) provider, even on 0.0.0.0', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await probeLlm({
      provider: 'lmstudio',
      lmStudioUrl: 'http://0.0.0.0:8080',
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
      provider: 'lmstudio',
      lmStudioUrl: 'http://0.0.0.0:8080',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/could not reach/i);
  });

  it('treats a cloud provider pointed at a local 0.0.0.0 base URL as key-optional', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await probeLlm({
      provider: 'openai',
      apiKey: '',
      openaiBaseUrl: 'http://0.0.0.0:1234/v1',
    });
    expect(res.ok).toBe(true);
  });

  it('still requires a key for a remote cloud provider with no key', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await probeLlm({ provider: 'openai', apiKey: '' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/needs an api key/i);
  });
});
