import { describe, expect, it } from '@jest/globals';
import { isLocalLlmUrl } from './localUrl';

describe('isLocalLlmUrl', () => {
  it('treats loopback / bind-all / mDNS hosts as local', () => {
    for (const u of [
      'http://localhost:1234/v1',
      'http://127.0.0.1:8080',
      'http://0.0.0.0:8080/v1',
      'http://[::1]:8080',
      'http://my-box.local:8080/v1',
    ]) {
      expect(isLocalLlmUrl(u)).toBe(true);
    }
  });

  it('treats private LAN ranges (RFC1918) as local', () => {
    for (const u of [
      'http://192.168.68.108:8080', // the LAN LM Studio / llama.cpp case
      'http://10.0.0.5:11434/v1',
      'http://100.93.149.119:8080/v1', // Tailscale / CGNAT self-hosted LLM
      'http://172.16.4.2:8000',
      'http://172.31.255.1:8080',
      'http://169.254.1.1:8080', // link-local
    ]) {
      expect(isLocalLlmUrl(u)).toBe(true);
    }
  });

  it('treats public endpoints as NOT local (a key is required)', () => {
    for (const u of [
      'https://api.openai.com/v1',
      'https://openrouter.ai/api/v1',
      'http://8.8.8.8:8080',
      'http://100.63.255.255:8080', // just below CGNAT
      'http://100.128.0.1:8080', // just above CGNAT
      'http://172.15.0.1:8080', // just below the 172.16/12 range
      'http://172.32.0.1:8080', // just above it
      'not a url',
    ]) {
      expect(isLocalLlmUrl(u)).toBe(false);
    }
  });
});
