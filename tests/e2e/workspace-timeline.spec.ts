/**
 * Wave 4 — Timeline panel inside the Workspace surface.
 *
 * The TimelinePanel reads from ProjectContext + TimelineDataContext +
 * useTimelineWebSocket. Driving its scenes/shots from a test would
 * require either:
 *   (a) seeding ProjectContext via the project-load pipeline
 *       (projectService → readProjectSnapshot → setState), or
 *   (b) replacing TimelineDataContext at the test layer.
 *
 * Neither is wired in the current Wave-1 harness. This spec pins
 * the only assertions we can make today: the panel mounts as part
 * of WorkspaceLayout and the hide/show toggle reaches its disabled
 * state. The play/scrub/select cases stay as test.fixme until the
 * harness gains a way to seed timeline data.
 */
import { test, expect } from './fixtures';

test.describe('Feature: Timeline panel', () => {
  test.describe('Given a project is open in the workspace', () => {
    test('When the workspace mounts, Then the TimelinePanel container is part of the layout', async ({
      page,
      bootInline,
    }) => {
      // Given
      await bootInline({
        surface: 'workspace',
        project: { name: 'noir', directory: '/tmp/noir.kshana' },
        rules: [],
      });

      // Then — the tab strip is visible (proxy: PreviewPanel mounted, which
      // owns the TimelinePanel below it via renderTimelineSection).
      await expect(
        page.getByRole('tab', { name: /Library/i }),
      ).toBeVisible();

      // And — the chat input is visible (workspace surface wires ChatPanel).
      await expect(
        page.getByPlaceholder(/Type a task and press send/i),
      ).toBeVisible();
    });

  });
});
