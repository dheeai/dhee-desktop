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
