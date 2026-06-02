import { describe, expect, it, jest } from '@jest/globals';
import { classifyProjectState } from './classifyProjectState';

function makeReader(files: Record<string, string | null>) {
  return {
    readFile: jest.fn(async (path: string) =>
      Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null,
    ) as (p: string) => Promise<string | null>,
  };
}

const PROJECT_JSON_PATH = '/tmp/p/project.json';
const MANIFEST_PATH = '/tmp/p/assets/manifest.json';

describe('classifyProjectState', () => {
  // ── 'fresh' ───────────────────────────────────────────────────────

  it('returns "fresh" when projectDirectory is empty', async () => {
    expect(await classifyProjectState('', makeReader({}))).toBe('fresh');
  });

  it('returns "fresh" when project.json is missing', async () => {
    expect(await classifyProjectState('/tmp/p', makeReader({}))).toBe('fresh');
  });

  it('returns "fresh" when project.json is malformed JSON', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({ [PROJECT_JSON_PATH]: 'not-json' }),
      ),
    ).toBe('fresh');
  });

  it('returns "fresh" when style is empty (the desktop stub case)', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: '',
            templateId: 'narrative',
            targetDuration: 60,
          }),
        }),
      ),
    ).toBe('fresh');
  });

  it('returns "fresh" when templateId is missing', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'cinematic_realism',
            targetDuration: 60,
          }),
        }),
      ),
    ).toBe('fresh');
  });

  it('returns "fresh" when duration / targetDuration both missing', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'cinematic_realism',
            templateId: 'narrative',
          }),
        }),
      ),
    ).toBe('fresh');
  });

  // ── New bundle-driven path: bundleSource means configured ───────
  // Production Slate writes bundleSource + style + targetDuration but
  // NOT the legacy templateId. The classifier must recognize the new
  // shape, otherwise the agent kicks off the (now obsolete) setup
  // dance in chat.

  it('returns "in_progress" when bundleSource is set (Production Slate shape)', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            name: 'A new film',
            bundleSource: 'built-in:narrative_prompt_relay',
            style: 'cinematic_realism',
            targetDuration: 60,
            aspect: '16:9',
            // No templateId — Production Slate doesn't write it.
            createdAt: '2026-06-02T10:00:00.000Z',
          }),
        }),
      ),
    ).toBe('in_progress');
  });

  it('bundleSource alone is enough even when style/duration absent (bundle owns defaults)', async () => {
    // Edge case: caller writes the minimum. Bundle defaults haven't
    // been applied (shouldn't happen via the slate, but defensive).
    // We still trust bundleSource as the configuration marker.
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            bundleSource: 'built-in:narrative_prompt_relay',
          }),
        }),
      ),
    ).toBe('in_progress');
  });

  it('returns "completed" for a bundle-driven project whose goal.status is achieved', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            bundleSource: 'built-in:narrative_prompt_relay',
            goal: { status: 'achieved', achievedAt: 1700000000000 },
          }),
        }),
      ),
    ).toBe('completed');
  });

  // ── 'in_progress' ────────────────────────────────────────────────

  it('returns "in_progress" for a configured project with goal.status=active', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'cinematic_realism',
            templateId: 'narrative',
            targetDuration: 60,
            goal: { status: 'active', targetArtifacts: ['final_short'] },
          }),
        }),
      ),
    ).toBe('in_progress');
  });

  it('returns "in_progress" for a configured project with no goal field at all', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'cinematic_realism',
            templateId: 'narrative',
            targetDuration: 60,
          }),
        }),
      ),
    ).toBe('in_progress');
  });

  it('falls back to duration when targetDuration is absent', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'anime',
            templateId: 'narrative',
            duration: 30,
          }),
        }),
      ),
    ).toBe('in_progress');
  });

  it('returns "in_progress" when goal.status is "superseded" (project replaced, not finished)', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'anime',
            templateId: 'narrative',
            targetDuration: 60,
            goal: { status: 'superseded' },
          }),
        }),
      ),
    ).toBe('in_progress');
  });

  // ── 'completed' ──────────────────────────────────────────────────
  // Only project.json is the source of truth for lifecycle state. The
  // completion marker is goal.status === 'achieved' (set by
  // src/core/tools/builtin/plannerTools.ts:248 when the plan has zero
  // remaining steps).

  it('returns "completed" when goal.status === "achieved"', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'anime',
            templateId: 'narrative',
            targetDuration: 60,
            goal: { status: 'achieved', achievedAt: 1700000000000 },
          }),
        }),
      ),
    ).toBe('completed');
  });

  it('returns "completed" when goal.achievedAt is set even without status (defensive)', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'anime',
            templateId: 'narrative',
            targetDuration: 60,
            goal: { achievedAt: 1700000000000 },
          }),
        }),
      ),
    ).toBe('completed');
  });

  // ── Manifest is NEVER the source of truth ───────────────────────
  // Per the 2026-05-03 user directive: only project.json drives state
  // classification. The asset manifest is an output index, not a
  // state machine. Even a manifest full of final-video assets must
  // NOT flip the verdict to "completed" if project.json says active.

  it('IGNORES assets/manifest.json: a final_short in the manifest does not imply completed', async () => {
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'anime',
            templateId: 'narrative',
            targetDuration: 60,
            // goal.status is still 'active' — project.json says
            // we're not done, even if media exists on disk.
            goal: { status: 'active' },
          }),
          [MANIFEST_PATH]: JSON.stringify({
            assets: [
              { kind: 'final_short', path: 'final.mp4' },
              { kind: 'final_video', path: 'out.mp4' },
            ],
          }),
        }),
      ),
    ).toBe('in_progress');
  });

  it('IGNORES legacy project.json assets[]: only goal.status matters', async () => {
    // Old v2.0 schema kept assets[] inline. We deliberately do NOT
    // peek at it — goal.status is the contract.
    expect(
      await classifyProjectState(
        '/tmp/p',
        makeReader({
          [PROJECT_JSON_PATH]: JSON.stringify({
            style: 'anime',
            templateId: 'narrative',
            targetDuration: 60,
            assets: [{ kind: 'final_video', path: 'out.mp4' }],
            goal: { status: 'active' },
          }),
        }),
      ),
    ).toBe('in_progress');
  });

  it('does not call readFile on assets/manifest.json under any classification path', async () => {
    // Strong contract test: even when the project is "in_progress"
    // and we'd previously have probed the manifest as a fallback,
    // we must not read the manifest at all.
    const reader = makeReader({
      [PROJECT_JSON_PATH]: JSON.stringify({
        style: 'anime',
        templateId: 'narrative',
        targetDuration: 60,
        goal: { status: 'active' },
      }),
    });
    await classifyProjectState('/tmp/p', reader);
    const calledPaths = (reader.readFile as jest.Mock).mock.calls.map(
      (args) => (args as unknown[])[0],
    );
    expect(calledPaths).not.toContain(MANIFEST_PATH);
  });
});
