/**
 * True when a URL's host is loopback, a private LAN address (RFC1918),
 * link-local, or an mDNS *.local / *.lan name — i.e. a self-hosted server
 * (LM Studio / Ollama / llama.cpp / vLLM) that needs no API key.
 *
 * Used everywhere the "is the OpenAI-compatible endpoint local?" decision
 * is made: whether to require a key (UI + diagnostics + probe) and whether
 * the runtime can call it without one.
 */
export function isLocalLlmUrl(value: string): boolean {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan')) {
    return true;
  }

  // Strip IPv6 brackets; treat loopback / unspecified IPv6 as local.
  const h = host.replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::' || h === '0.0.0.0') {
    return true;
  }

  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT / Tailscale
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  }

  return false;
}
