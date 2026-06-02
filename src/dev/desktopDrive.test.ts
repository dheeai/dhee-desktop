/**
 * desktopDrive — unit tests for the CLI's per-command handlers.
 *
 * We don't boot Electron here. Each handler takes a Page-like
 * interface; the tests pass a stub that records calls and returns
 * scripted responses. End-to-end "did it actually drive the desktop"
 * is left to the e2e suite (gated on a real running window).
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  cmdClick,
  cmdEval,
  cmdGetText,
  cmdScreenshot,
  cmdTitle,
  cmdType,
  cmdUrl,
  cmdWaitFor,
  type DesktopDrivePage,
} from './desktopDrive';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeStubPage(overrides: Partial<DesktopDrivePage> = {}): {
  page: DesktopDrivePage;
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, ...args: unknown[]) => {
    calls[name] = args;
  };
  const page: DesktopDrivePage = {
    async screenshot(opts: { path?: string; fullPage?: boolean }) {
      record('screenshot', opts);
      return Buffer.from('PNG');
    },
    async click(selector: string, _opts?: { timeout?: number }) {
      record('click', selector);
    },
    async fill(selector: string, text: string) {
      record('fill', selector, text);
    },
    async type(selector: string, text: string) {
      record('type', selector, text);
    },
    async evaluate(expr: string) {
      record('evaluate', expr);
      return 42;
    },
    async textContent(selector: string) {
      record('textContent', selector);
      return 'hi';
    },
    async waitForSelector(selector: string, opts?: { timeout?: number }) {
      record('waitForSelector', selector, opts);
    },
    getByRole(role: string, opts?: { name?: string }) {
      record('getByRole', role, opts);
      return {
        async click(_clickOpts?: { timeout?: number }) {
          record('locator.click');
        },
      };
    },
    url() {
      return 'about:blank';
    },
    async title() {
      return 'dhee dev';
    },
    ...overrides,
  };
  return { page, calls };
}

describe('cmdScreenshot', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dhee-drive-shot-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes the screenshot to opts.out and reports the byte count', async () => {
    const { page, calls } = makeStubPage();
    const out = join(tmp, 'shot.png');
    const result = await cmdScreenshot(page, { out });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(out);
      expect(result.bytes).toBeGreaterThan(0);
    }
    expect((calls['screenshot'] as Array<{ path: string }>)[0].path).toBe(out);
  });

  it('reports an error if the screenshot call throws', async () => {
    const page: DesktopDrivePage = {
      ...makeStubPage().page,
      async screenshot(_opts: { path?: string; fullPage?: boolean }) {
        throw new Error('disk full');
      },
    };
    const result = await cmdScreenshot(page, { out: join(tmp, 'x.png') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/disk full/);
  });
});

describe('cmdClick', () => {
  it('uses getByRole when target looks like an accessible name (no CSS sigil)', async () => {
    const { page, calls } = makeStubPage();
    const result = await cmdClick(page, { target: 'New Project' });
    expect(result.ok).toBe(true);
    expect(calls['getByRole']).toBeDefined();
    expect(calls['click']).toBeUndefined();
  });

  it('uses page.click when target is a CSS selector', async () => {
    const { page, calls } = makeStubPage();
    const result = await cmdClick(page, { target: '[data-testid=start]' });
    expect(result.ok).toBe(true);
    expect(calls['click']).toEqual(['[data-testid=start]']);
    expect(calls['getByRole']).toBeUndefined();
  });

  it('returns ok=false with the underlying error when click throws', async () => {
    const page: DesktopDrivePage = {
      ...makeStubPage().page,
      async click(_selector: string, _opts?: { timeout?: number }) {
        throw new Error('Element not found');
      },
    };
    const result = await cmdClick(page, { target: '#missing' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });
});

describe('cmdType', () => {
  it('calls page.fill for fast bulk text entry', async () => {
    const { page, calls } = makeStubPage();
    const result = await cmdType(page, { selector: '#name', text: 'demo' });
    expect(result.ok).toBe(true);
    expect(calls['fill']).toEqual(['#name', 'demo']);
  });
});

describe('cmdEval', () => {
  it('returns the renderer result wrapped in {ok:true,result}', async () => {
    const { page } = makeStubPage();
    const r = await cmdEval(page, { expression: '1 + 1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe(42);
  });

  it('returns ok=false when the evaluate throws', async () => {
    const page: DesktopDrivePage = {
      ...makeStubPage().page,
      async evaluate<T>(_expression: string): Promise<T> {
        throw new Error('not allowed');
      },
    };
    const r = await cmdEval(page, { expression: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not allowed/);
  });
});

describe('cmdGetText', () => {
  it('defaults selector to body when not provided', async () => {
    const { page, calls } = makeStubPage();
    const r = await cmdGetText(page, {});
    expect(r.ok).toBe(true);
    expect(calls['textContent']).toEqual(['body']);
  });

  it('uses the given selector when provided', async () => {
    const { page, calls } = makeStubPage();
    const r = await cmdGetText(page, { selector: '[role=banner]' });
    expect(r.ok).toBe(true);
    expect(calls['textContent']).toEqual(['[role=banner]']);
  });

  it('returns empty string when the element has no text', async () => {
    const page: DesktopDrivePage = {
      ...makeStubPage().page,
      async textContent(_selector: string) {
        return null;
      },
    };
    const r = await cmdGetText(page, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('');
  });
});

describe('cmdWaitFor', () => {
  it('passes timeoutMs through to waitForSelector', async () => {
    const { page, calls } = makeStubPage();
    const r = await cmdWaitFor(page, { selector: '#chat', timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    expect(calls['waitForSelector']).toEqual(['#chat', { timeout: 5000 }]);
  });

  it('returns ok=false with the playwright timeout error message on timeout', async () => {
    const page: DesktopDrivePage = {
      ...makeStubPage().page,
      async waitForSelector(_selector: string, _opts?: { timeout?: number }) {
        throw new Error('Timeout 5000ms exceeded.');
      },
    };
    const r = await cmdWaitFor(page, { selector: '#x', timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/timeout/i);
  });
});

describe('cmdUrl + cmdTitle', () => {
  it('return the running window url + title', async () => {
    const { page } = makeStubPage();
    const u = await cmdUrl(page);
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.url).toBe('about:blank');
    const t = await cmdTitle(page);
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.title).toBe('dhee dev');
  });
});
