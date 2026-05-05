/**
 * Wave 7 — Manifest-watcher reaction.
 *
 * `ProjectContext.onManifestWritten` activates when:
 *   - `isImageSyncV2Enabled` is true (localStorage 'renderer.image_sync_v2')
 *   - A project directory is set
 *
 * When `project:manifest-written` fires with a path containing
 * 'assets/manifest.json', the handler calls
 * `projectService.readAssetManifest()` → `window.electron.project.readFile()`.
 * With `readFile` now recorded by the fake bridge, we can assert the call.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Manifest watch reaction', () => {
  test.describe('Given the project is open and onManifestWritten is subscribed', () => {
    test('When emitElectron fires project:manifest-written, Then project.readFile is called to re-read the manifest', async ({
      page,
      bootInline,
    }) => {
      // Given — workspace surface with a project; enable imageSyncV2
      // flag BEFORE React mounts so ProjectContext sees it on first render.
      await page.addInitScript(() => {
        window.localStorage.setItem('renderer.image_sync_v2', 'true');
      });
      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // Record baseline readFile call count (project load may already
      // have triggered some reads).
      const baseline = await page.evaluate(
        () => window.__kshanaTest!.getCalls('project.readFile').length,
      );

      // When — emit manifest-written for the assets manifest path
      await page.evaluate(() => {
        window.__kshanaTest!.emitElectron('project:manifest-written', {
          path: '/tmp/noir.kshana/assets/manifest.json',
        });
      });

      // Then — at least one additional readFile call triggered
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__kshanaTest!.getCalls('project.readFile').length,
            ),
          { timeout: 5_000 },
        )
        .toBeGreaterThan(baseline);
    });
  });
});
