import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { probeLlm, runProviderDiagnostics } from './providerDiagnostics';
import type { AppSettings, AccountInfo } from '../shared/settingsTypes';

// A minimal AppSettings factory. Each diagnostic only reads a handful of
// fields; we cast a partial through unknown so the test stays readable
// without enumerating the (large) full settings shape. Override per test.
function makeSettings(overrides: Partial<AppSettings>): AppSettings {
  return {
    comfyBackend: 'local',
    llmBackend: 'local',
    vlmBackend: 'local',
    comfyuiMode: 'inherit',
    comfyuiUrl: '',
    llmProvider: 'openai',
    googleApiKey: '',
    geminiModel: '',
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    vlmJudge: false,
    vlmProvider: 'openai',
    vlmApiKey: '',
    vlmBaseUrl: '',
    vlmModel: '',
    ...overrides,
  } as unknown as AppSettings;
}

const account: AccountInfo = {
  userId: 'u1',
  email: 'pilot@dhee.studio',
  credits: 100,
  token: 'jwt',
};

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
});

describe('probeLlm — reachability & model enumeration', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('reports reachable with a model count when /models returns a list', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
      }),
    })) as unknown as typeof fetch;

    const res = await probeLlm({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.message).toMatch(/2 models available/i);
      expect(res.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    }
  });

  it('surfaces an HTTP status as an actionable auth error on bad key', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
    })) as unknown as typeof fetch;

    const res = await probeLlm({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-bad',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/could not reach/i);
      expect(res.detail).toBe('HTTP 401');
    }
  });

  it('sends the Authorization header when an api key is provided', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await probeLlm({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-abc',
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers?: Record<string, string> },
    ];
    expect(firstCall[1].headers?.Authorization).toBe('Bearer sk-abc');
  });

  it('gemini path: requires a key, then verifies it', async () => {
    const noKey = await probeLlm({ provider: 'gemini', apiKey: '' });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.message).toMatch(/google api key/i);

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;
    const verified = await probeLlm({
      provider: 'gemini',
      apiKey: 'AIza-test',
      model: 'gemini-1.5-pro',
    });
    expect(verified.ok).toBe(true);
    if (verified.ok)
      expect(verified.message).toMatch(/gemini key verified for gemini-1\.5/i);
  });

  it('treats an aborted/thrown fetch (timeout) as unreachable, not auth', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('The operation was aborted');
    }) as unknown as typeof fetch;

    const res = await probeLlm({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/could not reach/i);
      expect(res.detail).toMatch(/aborted/i);
    }
  });
});

describe('runProviderDiagnostics — snapshot shaping', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function findItem(
    snapshot: Awaited<ReturnType<typeof runProviderDiagnostics>>,
    id: string,
  ) {
    const item = snapshot.items.find((i) => i.id === id);
    if (!item) throw new Error(`missing diagnostic item: ${id}`);
    return item;
  }

  it('always returns four items (account, comfyui, llm, vlm) with a timestamp', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const snapshot = await runProviderDiagnostics(
      makeSettings({ comfyuiMode: 'custom', comfyuiUrl: 'http://localhost:8188' }),
      account,
    );

    expect(typeof snapshot.checkedAt).toBe('number');
    expect(snapshot.items.map((i) => i.id)).toEqual([
      'cloud-account',
      'comfyui',
      'llm',
      'vlm',
    ]);
  });

  it('cloud-account is ready when signed in, warning when not', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const signedIn = await runProviderDiagnostics(makeSettings({}), account);
    expect(findItem(signedIn, 'cloud-account')).toMatchObject({
      status: 'ready',
      message: expect.stringContaining('pilot@dhee.studio'),
    });

    const signedOut = await runProviderDiagnostics(makeSettings({}), null);
    expect(findItem(signedOut, 'cloud-account').status).toBe('warning');
  });

  it('comfyui ready when /system_stats is reachable', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const snapshot = await runProviderDiagnostics(
      makeSettings({
        comfyuiMode: 'custom',
        comfyuiUrl: 'http://localhost:8188',
      }),
      account,
    );
    const comfy = findItem(snapshot, 'comfyui');
    expect(comfy.status).toBe('ready');
    expect(comfy.message).toMatch(/reachable at http:\/\/localhost:8188/i);
  });

  it('comfyui warning (with HTTP detail) when unreachable', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 502,
    })) as unknown as typeof fetch;

    const snapshot = await runProviderDiagnostics(
      makeSettings({
        comfyuiMode: 'custom',
        comfyuiUrl: 'http://localhost:8188',
      }),
      account,
    );
    const comfy = findItem(snapshot, 'comfyui');
    expect(comfy.status).toBe('warning');
    expect(comfy.detail).toBe('HTTP 502');
  });

  it('comfyui cloud-backed is ready with account, warning without', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const withAcct = await runProviderDiagnostics(
      makeSettings({ comfyBackend: 'cloud' }),
      account,
    );
    expect(findItem(withAcct, 'comfyui').status).toBe('ready');

    const noAcct = await runProviderDiagnostics(
      makeSettings({ comfyBackend: 'cloud' }),
      null,
    );
    expect(findItem(noAcct, 'comfyui').status).toBe('warning');
  });

  it('llm: a REMOTE openai endpoint with no key is an error (not warning)', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const snapshot = await runProviderDiagnostics(
      makeSettings({
        llmProvider: 'openai',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: '',
      }),
      account,
    );
    const llm = findItem(snapshot, 'llm');
    expect(llm.status).toBe('warning'); // missing-key short-circuit
    expect(llm.message).toMatch(/needs an api key/i);
  });

  it('llm: remote endpoint reachable failure is status=error, local is warning', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
    })) as unknown as typeof fetch;

    const remote = await runProviderDiagnostics(
      makeSettings({
        llmProvider: 'openai',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: 'sk-x',
      }),
      account,
    );
    expect(findItem(remote, 'llm').status).toBe('error');

    const local = await runProviderDiagnostics(
      makeSettings({
        llmProvider: 'openai',
        openaiBaseUrl: 'http://localhost:1234',
        openaiApiKey: '',
      }),
      account,
    );
    expect(findItem(local, 'llm').status).toBe('warning');
  });

  it('llm: gemini without a key warns', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const snapshot = await runProviderDiagnostics(
      makeSettings({ llmProvider: 'gemini', googleApiKey: '' }),
      account,
    );
    const llm = findItem(snapshot, 'llm');
    expect(llm.status).toBe('warning');
    expect(llm.message).toMatch(/google api key/i);
  });

  it('vlm is "unknown / turned off" when vlmJudge is disabled', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const snapshot = await runProviderDiagnostics(
      makeSettings({ vlmJudge: false }),
      account,
    );
    const vlm = findItem(snapshot, 'vlm');
    expect(vlm.status).toBe('unknown');
    expect(vlm.message).toMatch(/turned off/i);
  });

  it('vlm local needs base url + key + model; warns when incomplete', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const snapshot = await runProviderDiagnostics(
      makeSettings({
        vlmJudge: true,
        vlmProvider: 'openai',
        vlmBaseUrl: '',
        vlmApiKey: '',
        vlmModel: '',
      }),
      account,
    );
    expect(findItem(snapshot, 'vlm').status).toBe('warning');
  });

  it('vlm local ready when complete config + endpoint reachable', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const snapshot = await runProviderDiagnostics(
      makeSettings({
        vlmJudge: true,
        vlmProvider: 'openai',
        vlmBaseUrl: 'http://localhost:8000',
        vlmApiKey: 'key',
        vlmModel: 'qwen-vl',
      }),
      account,
    );
    const vlm = findItem(snapshot, 'vlm');
    expect(vlm.status).toBe('ready');
    expect(vlm.message).toMatch(/qwen-vl/);
  });
});
