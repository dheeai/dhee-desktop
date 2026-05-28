/**
 * desktop-drive — Claude-Code-driven remote control for a running
 * dhee desktop (Electron).
 *
 * Two halves:
 *   1. Per-command async handlers (`cmdScreenshot`, `cmdClick`, …)
 *      take a Page-like interface so they're unit-testable with a
 *      stub. Each returns a JSON-serializable result envelope.
 *   2. A CLI shim (at the bottom) that:
 *        - reads DHEE_DEBUG_PORT (defaults to 9223)
 *        - connects to the running Electron via Playwright
 *          `chromium.connectOverCDP('http://localhost:<port>')`
 *        - picks the first BrowserWindow page (filterable by title)
 *        - dispatches to a handler, prints JSON, exits.
 *
 * Connection is per-invocation (Claude Code Bash is one-shot). Each
 * command spends ~50ms on connection setup over local CDP.
 *
 * SECURITY: --remote-debugging-port opens a localhost TCP port that
 * anything on this machine can attach to. Enabled in main.ts ONLY
 * when DHEE_DEBUG_PORT is set, so packaged production builds never
 * expose it.
 *
 * Pattern adapted from
 * /Users/ganaraj/Projects/aim-scoring-agent/DRIVING_PI_FROM_CLAUDE_CODE.md
 * — one-shot CLI per turn keeps each Bash call self-contained.
 */

import { writeFileSync } from 'node:fs';

/**
 * The subset of Playwright's Page we actually use. Keeping this
 * narrow makes the unit tests cheap (stub a small surface).
 */
export interface DesktopDrivePage {
  screenshot(opts: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
  getByRole(role: string, opts?: { name?: string }): {
    click(opts?: { timeout?: number }): Promise<void>;
  };
  url(): string;
  title(): Promise<string>;
}

/* ── result envelopes ───────────────────────────────────────────────── */

export type Ok<T> = { ok: true } & T;
export type Err = { ok: false; error: string };

const err = (e: unknown): Err => ({
  ok: false,
  error: (e as Error)?.message ?? String(e),
});

/* ── per-command handlers ───────────────────────────────────────────── */

export async function cmdScreenshot(
  page: DesktopDrivePage,
  opts: { out: string; fullPage?: boolean },
): Promise<Ok<{ path: string; bytes: number }> | Err> {
  try {
    const buf = await page.screenshot({ path: opts.out, fullPage: opts.fullPage ?? false });
    // Playwright already wrote the file via { path: ... }; we also have
    // the buffer for byte accounting. Done.
    return { ok: true, path: opts.out, bytes: buf.byteLength };
  } catch (e) {
    return err(e);
  }
}

/**
 * Click by accessible name (`getByRole`) when target looks like a
 * human-readable name (no CSS sigils), otherwise treat as a CSS
 * selector. This heuristic matches how a tester would think.
 */
function looksLikeSelector(target: string): boolean {
  return /[#.[\]:>~+]/.test(target) || target.includes(' ') === false ? /[#.[\]:>~+]/.test(target) : false;
}

export async function cmdClick(
  page: DesktopDrivePage,
  opts: { target: string; role?: string; timeoutMs?: number },
): Promise<Ok<{ via: 'role' | 'selector' }> | Err> {
  try {
    if (looksLikeSelector(opts.target)) {
      await page.click(opts.target, opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined);
      return { ok: true, via: 'selector' };
    }
    const locator = page.getByRole(opts.role ?? 'button', { name: opts.target });
    await locator.click(opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined);
    return { ok: true, via: 'role' };
  } catch (e) {
    return err(e);
  }
}

export async function cmdType(
  page: DesktopDrivePage,
  opts: { selector: string; text: string },
): Promise<Ok<unknown> | Err> {
  try {
    await page.fill(opts.selector, opts.text);
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function cmdEval(
  page: DesktopDrivePage,
  opts: { expression: string },
): Promise<Ok<{ result: unknown }> | Err> {
  try {
    const result = await page.evaluate(opts.expression);
    return { ok: true, result };
  } catch (e) {
    return err(e);
  }
}

export async function cmdGetText(
  page: DesktopDrivePage,
  opts: { selector?: string },
): Promise<Ok<{ text: string }> | Err> {
  try {
    const sel = opts.selector ?? 'body';
    const text = (await page.textContent(sel)) ?? '';
    return { ok: true, text };
  } catch (e) {
    return err(e);
  }
}

export async function cmdWaitFor(
  page: DesktopDrivePage,
  opts: { selector: string; timeoutMs?: number },
): Promise<Ok<unknown> | Err> {
  try {
    await page.waitForSelector(opts.selector, opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined);
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function cmdUrl(page: DesktopDrivePage): Promise<Ok<{ url: string }>> {
  return { ok: true, url: page.url() };
}

export async function cmdTitle(
  page: DesktopDrivePage,
): Promise<Ok<{ title: string }> | Err> {
  try {
    const title = await page.title();
    return { ok: true, title };
  } catch (e) {
    return err(e);
  }
}

/* ── connection ─────────────────────────────────────────────────────── */

const DEFAULT_DEBUG_PORT = 9223;

interface CdpConnection {
  page: DesktopDrivePage;
  close: () => Promise<void>;
}

/**
 * Connect to the running Electron via CDP, pick the first BrowserWindow
 * page (matching titleHint when provided). Lazy-imports Playwright so
 * the test file can stub the page directly without dragging
 * @playwright/test into Jest's loader.
 */
async function connectToDesktop(opts: { port: number; titleHint?: string }): Promise<CdpConnection> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.connectOverCDP(`http://localhost:${opts.port}`);
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());
  if (pages.length === 0) {
    await browser.close();
    throw new Error(
      `No pages found at CDP endpoint http://localhost:${opts.port}. Is the desktop running with DHEE_DEBUG_PORT=${opts.port}?`,
    );
  }
  let picked = pages[0];
  if (opts.titleHint) {
    for (const p of pages) {
      const t = await p.title();
      if (t.includes(opts.titleHint)) {
        picked = p;
        break;
      }
    }
  }
  return {
    page: picked as unknown as DesktopDrivePage,
    async close() {
      await browser.close();
    },
  };
}

/* ── CLI dispatcher ─────────────────────────────────────────────────── */

interface CliArgs {
  command: string;
  // Positional + flag args, parsed loosely. Each handler picks what it needs.
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command: command ?? '', positional, flags };
}

function usage(): string {
  return `Usage: desktop-drive <command> [args]
Commands:
  screenshot --out <path> [--full]                Capture the current window.
  click "<text|selector>" [--role button] [--timeout ms]
  type "<selector>" "<text>"
  eval "<js expression>"                          Returns the renderer result as JSON.
  text [--selector "<css>"]                       Defaults to body.
  wait-for "<selector>" [--timeout ms]
  url
  title
Env:
  DHEE_DEBUG_PORT (default 9223)
  DHEE_DEBUG_TITLE                                Optional title hint to disambiguate windows.`;
}

async function dispatch(args: CliArgs): Promise<unknown> {
  const port = Number(process.env['DHEE_DEBUG_PORT'] ?? DEFAULT_DEBUG_PORT);
  const titleHint = process.env['DHEE_DEBUG_TITLE'];
  let conn: CdpConnection | undefined;
  try {
    conn = await connectToDesktop({ port, ...(titleHint ? { titleHint } : {}) });
  } catch (e) {
    return err(e);
  }
  try {
    switch (args.command) {
      case 'screenshot': {
        const out = (args.flags['out'] as string) ?? args.positional[0];
        if (!out) return { ok: false, error: 'screenshot needs --out <path>' };
        const r = await cmdScreenshot(conn.page, { out, fullPage: !!args.flags['full'] });
        return r;
      }
      case 'click': {
        const target = args.positional[0];
        if (!target) return { ok: false, error: 'click needs a target' };
        const role = args.flags['role'] as string | undefined;
        const timeoutMs = args.flags['timeout'] ? Number(args.flags['timeout']) : undefined;
        return cmdClick(conn.page, {
          target,
          ...(role ? { role } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }
      case 'type': {
        const [selector, text] = args.positional;
        if (!selector || text === undefined) {
          return { ok: false, error: 'type needs <selector> <text>' };
        }
        return cmdType(conn.page, { selector, text });
      }
      case 'eval': {
        const expression = args.positional[0];
        if (!expression) return { ok: false, error: 'eval needs an expression' };
        return cmdEval(conn.page, { expression });
      }
      case 'text': {
        const selector = args.flags['selector'] as string | undefined;
        return cmdGetText(conn.page, selector ? { selector } : {});
      }
      case 'wait-for': {
        const selector = args.positional[0];
        if (!selector) return { ok: false, error: 'wait-for needs a selector' };
        const timeoutMs = args.flags['timeout'] ? Number(args.flags['timeout']) : 30_000;
        return cmdWaitFor(conn.page, { selector, timeoutMs });
      }
      case 'url':
        return cmdUrl(conn.page);
      case 'title':
        return cmdTitle(conn.page);
      default:
        return { ok: false, error: `Unknown command '${args.command}'\n\n${usage()}` };
    }
  } finally {
    await conn.close();
  }
}

const isMainEntry =
  process.argv[1]?.endsWith('desktopDrive.ts') === true ||
  process.argv[1]?.endsWith('desktopDrive.js') === true;

if (isMainEntry) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    if (!args.command) {
      process.stderr.write(usage() + '\n');
      process.exit(2);
    }
    const result = await dispatch(args);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if ((result as { ok?: boolean }).ok === false) process.exit(1);
  })().catch((e) => {
    process.stderr.write(`desktop-drive: fatal: ${(e as Error).message}\n`);
    process.exit(1);
  });
}

// Reference unused import so eslint-no-unused-vars stays quiet — kept
// for future "write JSON sidecar" feature on screenshot.
void writeFileSync;
