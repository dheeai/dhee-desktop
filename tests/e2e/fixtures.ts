import { test as base, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCENARIO_DIR = path.join(__dirname, 'scenarios');

export type ScenarioSurface = 'chat' | 'landing' | 'workspace';

export interface Scenario {
  project?: { name: string; directory?: string };
  surface?: ScenarioSurface;
  bridgeReturns?: Record<string, unknown>;
  /** Per-path file content for `window.electron.project.readFile`. Keys are matched as path suffixes. */
  fileReturns?: Record<string, string | null>;
  rules: Array<{
    on: { channel: string; match?: string };
    emit: Array<{ after?: number; event: string; data: unknown }>;
  }>;
}

export function loadScenarioFromDisk(name: string): Scenario {
  const file = path.join(SCENARIO_DIR, name);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Scenario;
}

export interface BridgeFixtures {
  /**
   * Boots the renderer with the given scenario seeded BEFORE React mounts.
   *
   * The "ready" condition depends on `scenario.surface`:
   *   - `chat` (default) — waits for the chat input placeholder.
   *   - `landing` — waits for the landing screen sidebar/title.
   *   - `workspace` — waits for the workspace tab strip.
   */
  bootWithScenario(scenarioFile: string): Promise<void>;
  /**
   * Boots the renderer with an inline scenario (no JSON file). Useful for
   * tests that only need a surface + project, no scripted kshana events.
   */
  bootInline(scenario: Scenario): Promise<void>;
}

async function seedAndNavigate(page: Page, scenario: Scenario): Promise<void> {
  await page.addInitScript((s) => {
    (window as unknown as { __pendingScenario?: unknown }).__pendingScenario =
      s;
  }, scenario);

  await page.goto('/');

  await page.waitForFunction(
    () => typeof window.__kshanaTest !== 'undefined',
    { timeout: 10_000 },
  );
  await page.evaluate(() => {
    const pending = (
      window as unknown as { __pendingScenario?: unknown }
    ).__pendingScenario;
    if (pending) {
      (
        window.__kshanaTest as unknown as {
          loadScenario(s: unknown): void;
        }
      ).loadScenario(pending);
    }
  });
}

async function waitForSurfaceReady(
  page: Page,
  surface: ScenarioSurface,
): Promise<void> {
  const TIMEOUT = 15_000;
  switch (surface) {
    case 'chat':
      await page
        .getByPlaceholder(/Type a task and press send/i)
        .waitFor({ state: 'visible', timeout: TIMEOUT });
      return;
    case 'landing':
      // Landing renders a "Kshana Desktop" brand heading in the sidebar.
      await page
        .getByRole('heading', { name: /Kshana Desktop/i })
        .waitFor({ state: 'visible', timeout: TIMEOUT });
      return;
    case 'workspace':
      // Workspace mounts the chat panel inside the layout — same selector
      // as the chat surface, but the surrounding shell is the full layout.
      await page
        .getByPlaceholder(/Type a task and press send/i)
        .waitFor({ state: 'visible', timeout: TIMEOUT });
      return;
    default:
      return;
  }
}

export const test = base.extend<BridgeFixtures>({
  bootWithScenario: async ({ page }, use) => {
    const boot = async (scenarioFile: string) => {
      const scenario = loadScenarioFromDisk(scenarioFile);
      await seedAndNavigate(page, scenario);
      await waitForSurfaceReady(page, scenario.surface ?? 'chat');
    };
    await use(boot);
  },
  bootInline: async ({ page }, use) => {
    const boot = async (scenario: Scenario) => {
      await seedAndNavigate(page, scenario);
      await waitForSurfaceReady(page, scenario.surface ?? 'chat');
    };
    await use(boot);
  },
});

export { expect, type Page };
