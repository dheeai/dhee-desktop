/**
 * Pure helpers for computing landing-card metadata from on-disk project
 * artifacts. Kept separate from `LandingScreen.tsx` so they can be
 * unit-tested against synthesized inputs without an Electron bridge.
 *
 * Data-source decisions (load-bearing — empirically validated against
 * Better Image's 1779423804 manifest which had 11 scene_image entries
 * that were all 11 *versions* of `s1shot1`, not 11 different shots):
 *
 *   - **Counts come from `prompts/videos/scenes/scene_<N>.json`**
 *     (the scene_video_prompt outputs). One file per scene; each
 *     file's `shots[]` array is the per-shot plan. This is what the
 *     project IS — the planner's authoritative shape.
 *
 *   - **Thumbnail picking uses `assets/manifest.json` scene_image
 *     entries** filtered to those that have a usable path. Many
 *     entries have null `scene_number` / `metadata.shot_number`, so
 *     we fall back to parsing the file path (`s<N>shot<M>_...`) to
 *     recover the (scene, shot) when the manifest fields are missing.
 *
 *   - **`meet_character` matching** runs against scene_video_prompt's
 *     `shots[].purpose` to find hero-intro shots, then pairs against
 *     scene_image manifest entries by (scene, shot). Hero introductions
 *     make the most identifiable thumbnails.
 *
 * Never trusted: project.json's top-level `scenes` / `characters`
 * arrays. They're legacy stubs the pipeline stopped populating after
 * the dep-graph migration.
 */

/**
 * A parsed scene_video_prompt file as we care about it for thumbnail
 * selection and counting — just shot count + purpose mapping. Extra
 * fields ignored.
 */
export interface SVPShape {
  shots?: Array<
    { shotNumber?: unknown; purpose?: unknown } | null | undefined
  >;
}

/** Manifest entry we care about for landing-card display. */
export interface ManifestSceneImage {
  scene: number;
  shot: number;
  path: string;
}

/**
 * Parse `(scene, shot)` from a scene_image's file path when the
 * manifest metadata is missing/null. Path pattern:
 *   `assets/images/s<N>shot<M>_<frame>_<provider>_<hash>.png`
 * Returns null when the pattern doesn't match.
 */
export function parseSceneShotFromPath(
  path: string,
): { scene: number; shot: number } | null {
  const m = /(?:^|\/)s(\d+)shot(\d+)_/.exec(path);
  if (!m || !m[1] || !m[2]) return null;
  const scene = parseInt(m[1], 10);
  const shot = parseInt(m[2], 10);
  if (!Number.isFinite(scene) || !Number.isFinite(shot)) return null;
  return { scene, shot };
}

/**
 * Extract `scene_image` entries from an `assets/manifest.json` parse.
 * Recovers (scene, shot) from the file path when manifest metadata is
 * missing — observed in real projects where regen / last-frame writes
 * landed entries with null `scene_number` and null `metadata.shot_number`.
 * Silently drops entries from which (scene, shot) cannot be recovered.
 */
export function extractSceneImages(
  manifest: { assets?: Array<unknown> } | null | undefined,
): ManifestSceneImage[] {
  if (!manifest || !Array.isArray(manifest.assets)) return [];
  const out: ManifestSceneImage[] = [];
  for (const raw of manifest.assets) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as {
      type?: unknown;
      scene_number?: unknown;
      path?: unknown;
      metadata?: { shot_number?: unknown } | null;
    };
    if (entry.type !== 'scene_image') continue;
    if (typeof entry.path !== 'string' || !entry.path) continue;

    let scene: number | null =
      typeof entry.scene_number === 'number' ? entry.scene_number : null;
    let shot: number | null =
      typeof entry.metadata?.shot_number === 'number'
        ? entry.metadata.shot_number
        : null;

    if (scene === null || shot === null) {
      const parsed = parseSceneShotFromPath(entry.path);
      if (parsed) {
        scene = scene ?? parsed.scene;
        shot = shot ?? parsed.shot;
      }
    }
    if (scene === null || shot === null) continue;
    out.push({ scene, shot, path: entry.path });
  }
  return out;
}

/**
 * Sum scenes and shots from the planner's `scene_video_prompt` files.
 *
 * Each entry in `svps` is one scene; each scene's `shots[]` length is
 * its planned shot count. `scenes` is the number of entries; `shots`
 * is the total across all of them.
 *
 * Manifest-based counting is wrong because the manifest stores asset
 * *versions* — regenerating shot 1 eleven times produces 11 manifest
 * entries all tagged `(scene=1, shot=1)`. The planner's per-scene file
 * is the authoritative project shape.
 */
export function sumScenesAndShots(
  svps: Record<number, SVPShape | null | undefined>,
): { scenes: number; shots: number } {
  let scenes = 0;
  let shots = 0;
  for (const svp of Object.values(svps)) {
    if (!svp) continue;
    scenes += 1;
    if (Array.isArray(svp.shots)) shots += svp.shots.length;
  }
  return { scenes, shots };
}

/**
 * Bundle-format equivalent of sumScenesAndShots.
 *
 * Bundle projects (narrative_prompt_relay, narrative_qwen_chain_relay,
 * etc.) write a single `plans/scenes_plan.json` containing both arrays:
 *   {
 *     scenes: [{ id: 'scene_1', ... }, ...],
 *     shots:  [{ id: 'scene_1_shot_1', scene: 1, shotNumber: 1, ... }, ...]
 *   }
 *
 * scene count = scenes.length OR distinct shot.scene values
 * shot count  = shots.length
 *
 * Returns null when the input doesn't match the expected shape — caller
 * falls back to the legacy per-scene-file counter.
 */
export function sumScenesAndShotsFromPlan(
  scenesPlan: { scenes?: unknown; shots?: unknown } | null | undefined,
): { scenes: number; shots: number } | null {
  if (!scenesPlan || typeof scenesPlan !== 'object') return null;
  const shots = Array.isArray(scenesPlan.shots) ? scenesPlan.shots : null;
  const scenes = Array.isArray(scenesPlan.scenes) ? scenesPlan.scenes : null;
  if (!shots && !scenes) return null;
  // Prefer scenes.length; if absent, derive from distinct shot.scene.
  let sceneCount = 0;
  if (scenes) {
    sceneCount = scenes.length;
  } else if (shots) {
    const seen = new Set<number>();
    for (const s of shots) {
      if (s && typeof s === 'object' && typeof (s as { scene?: unknown }).scene === 'number') {
        seen.add((s as { scene: number }).scene);
      }
    }
    sceneCount = seen.size;
  }
  return { scenes: sceneCount, shots: shots ? shots.length : 0 };
}

/**
 * Scan walkState (or executorState) for the most recent completed shot
 * first-frame image. Returns the outputPath (relative to projectDir) or
 * null. Heuristic: matches any walkState entry whose key looks like
 * `<nodeId>:scene_N_shot_M`, status === 'completed', and outputPath
 * ends in `_first.png` OR `_first_frame_*.png`. Doesn't need to know
 * the bundle's node ids — just the artifact naming convention shared
 * across all narrative bundles.
 *
 * Returns the FIRST hit (which thanks to walker write-order is roughly
 * the lowest scene/shot — i.e. an opening frame). Callers prepend
 * projectDir to get an absolute path.
 */
export function findShotThumbnailFromWalkState(
  state: { nodes?: Record<string, { status?: string; outputPath?: string }> } | null | undefined,
): string | null {
  const nodes = state?.nodes;
  if (!nodes) return null;
  // Find scene_1_shot_1's first frame first if available, then 1_2, etc.
  // We sort the keys by (scene, shot) for determinism.
  const candidates: Array<{ scene: number; shot: number; outputPath: string }> = [];
  for (const [key, node] of Object.entries(nodes)) {
    if (node.status !== 'completed' || !node.outputPath) continue;
    if (!/_first(_frame)?[_.]/.test(node.outputPath)) continue;
    const m = key.match(/scene_(\d+)_shot_(\d+)/);
    if (!m) continue;
    candidates.push({
      scene: parseInt(m[1]!, 10),
      shot: parseInt(m[2]!, 10),
      outputPath: node.outputPath,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.scene - b.scene || a.shot - b.shot);
  return candidates[0]!.outputPath;
}

/**
 * From a collection of scene_video_prompt parses (keyed by scene
 * number), extract every `(scene, shot)` pair whose `purpose` is
 * `meet_character`. These are usually hero introductions and make
 * the most identifiable thumbnails.
 *
 * Returns a Set of `"<scene>_<shot>"` keys so callers can membership-
 * test directly against `ManifestSceneImage` entries.
 */
export function collectMeetCharacterShots(
  svps: Record<number, SVPShape | null | undefined>,
): Set<string> {
  const out = new Set<string>();
  for (const [sceneStr, svp] of Object.entries(svps)) {
    if (!svp || !Array.isArray(svp.shots)) continue;
    const scene = Number(sceneStr);
    if (!Number.isFinite(scene)) continue;
    for (const shot of svp.shots) {
      if (!shot || typeof shot !== 'object') continue;
      if (shot.purpose !== 'meet_character') continue;
      if (typeof shot.shotNumber !== 'number') continue;
      out.add(`${scene}_${shot.shotNumber}`);
    }
  }
  return out;
}

/**
 * Pick a thumbnail-worthy `scene_image` from the manifest, preferring
 * shots tagged `meet_character` in their scene_video_prompt.
 *
 * Selection order:
 *   1. If any scene_image matches a `meet_character` (scene, shot)
 *      pair → pick one at random from those.
 *   2. Otherwise → pick one at random from all scene_images.
 *   3. Empty input → return `null`.
 *
 * Randomness rather than "first" so multiple visits to the landing
 * screen don't always show the same frame — gives the gallery a bit
 * of life. The `rng` parameter defaults to `Math.random` but is
 * injectable for deterministic tests.
 */
export function selectSmartThumbnail(
  images: ManifestSceneImage[],
  meetCharacterShots: Set<string>,
  rng: () => number = Math.random,
): ManifestSceneImage | null {
  if (images.length === 0) return null;
  const meetCandidates = images.filter((img) =>
    meetCharacterShots.has(`${img.scene}_${img.shot}`),
  );
  const pool = meetCandidates.length > 0 ? meetCandidates : images;
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.min(idx, pool.length - 1)] ?? null;
}
