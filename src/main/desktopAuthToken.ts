export interface DesktopAuthPayload {
  sub: string;
  email: string;
  name?: string | null;
}

export function parseDesktopAuthToken(
  token: string,
): DesktopAuthPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as {
      sub?: unknown;
      email?: unknown;
      name?: unknown;
      type?: unknown;
      exp?: unknown;
    };

    if (payload.type !== 'desktop') return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    if (typeof payload.email !== 'string' || !payload.email) return null;
    if (typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  } catch {
    return null;
  }
}
