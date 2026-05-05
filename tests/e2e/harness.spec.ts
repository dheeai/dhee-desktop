/**
 * Smoke tests for the Wave-1 harness extensions:
 *   - `Scenario.surface` is honored by `TestApp`.
 *   - `setBridgeReturn` overrides default fake return values.
 *   - `emitElectron` fires into subscribed listeners.
 *
 * These do not exercise product features; they pin the contract that
 * Waves 2–7 depend on. If one of these fails, the harness regressed.
 */
import { test, expect } from './fixtures';

test.describe('Harness: scenario surface switch', () => {
  test.describe('Given a scenario with surface=landing', () => {
    test('When the page boots, Then the LandingScreen renders (no chat input visible)', async ({
      page,
      bootWithScenario,
    }) => {
      // Given / When
      await bootWithScenario('harness-landing-empty.json');

      // Then — Landing-specific UI is present, chat input is not.
      await expect(
        page.getByRole('heading', { name: /Kshana Desktop/i }),
      ).toBeVisible();
      await expect(
        page.getByPlaceholder(/Type a task and press send/i),
      ).toHaveCount(0);

      // And — getSurface() reports the configured surface.
      const surface = await page.evaluate(() =>
        window.__kshanaTest?.getSurface(),
      );
      expect(surface).toBe('landing');
    });
  });

  test.describe('Given the default surface (chat)', () => {
    test('When a scenario with no surface field boots, Then getSurface() returns "chat"', async ({
      page,
      bootWithScenario,
    }) => {
      // Given / When — show-s1-shot-1.json has no surface field.
      await bootWithScenario('show-s1-shot-1.json');

      // Then
      const surface = await page.evaluate(() =>
        window.__kshanaTest?.getSurface(),
      );
      expect(surface).toBe('chat');
    });
  });
});

test.describe('Harness: bridge return seeding', () => {
  test.describe('Given a seeded recent-projects list', () => {
    test('When project.getRecent() is called, Then the seeded list is returned', async ({
      page,
      bootInline,
    }) => {
      // Given — boot landing surface with a seeded recent list.
      await bootInline({ surface: 'landing', rules: [] });
      await page.evaluate(() => {
        window.__kshanaTest!.setBridgeReturn('project.getRecent', [
          { name: 'noir', path: '/tmp/noir.kshana', lastOpened: 1 },
        ]);
      });

      // When
      const recent = await page.evaluate(() =>
        window.electron.project.getRecent(),
      );

      // Then
      expect(recent).toEqual([
        { name: 'noir', path: '/tmp/noir.kshana', lastOpened: 1 },
      ]);

      // And — the call is recorded.
      const calls = await page.evaluate(() =>
        window.__kshanaTest!.getCalls('project.getRecent'),
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});

test.describe('Harness: electron event emission', () => {
  test.describe('Given a renderer subscribed to backend:state', () => {
    test('When emitElectron fires a state update, Then the listener receives it', async ({
      page,
      bootInline,
    }) => {
      // Given — landing surface with a fresh subscriber.
      await bootInline({ surface: 'landing', rules: [] });
      await page.evaluate(() => {
        const buf: unknown[] = [];
        (window as unknown as { __testBuf: unknown[] }).__testBuf = buf;
        window.electron.backend.onStateChange((state) => {
          buf.push(state);
        });
      });

      // When
      await page.evaluate(() => {
        window.__kshanaTest!.emitElectron('backend:state', {
          status: 'ready',
          serverUrl: 'http://localhost:8001',
        });
      });

      // Then
      const buf = await page.evaluate(
        () => (window as unknown as { __testBuf: unknown[] }).__testBuf,
      );
      expect(buf).toEqual([
        { status: 'ready', serverUrl: 'http://localhost:8001' },
      ]);
    });
  });
});
