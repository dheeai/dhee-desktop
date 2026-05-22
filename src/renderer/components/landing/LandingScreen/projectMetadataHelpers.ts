/**
 * Pure helpers for computing landing-card metadata from on-disk project
 * artifacts. Kept separate from `LandingScreen.tsx` so they can be
 * unit-tested against synthesized inputs without an Electron bridge.
 *
 * Inputs:
 *   - `assets/manifest.json` — the authoritative source of generated
 *     content. Each `scene_image` entry carries `scene_number` (top
 *     level) + `metadata.shot_number` (snake_case). project.json's
 *     top-level `scenes` / `characters` arrays are legacy stubs the
 *     pipeline stopped populating after the dep-graph migration —
 *     don't trust them for counts.
 *   - `prompts/videos/scenes/scene_<N>.json` — the scene_video_prompt
 *     output (NOT the .plan.json or .state.json variants). Each shot
 *     here has a `purpose` field; `meet_character` shots are usually
 *     hero introductions and make the best thumbnails.
 */

/** Manifest entry we care about for landing-card display. */
export interface ManifestSceneImage {
  scene: number;
  shot: number;
  path: string;
}

/**
 * Extract `scene_image` entries from an `assets/manifest.json` parse.
 * Silently drops malformed entries — landing screen must not crash on
 * a single bad row.
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
    if (typeof entry.scene_number !== 'number') continue;
    if (typeof entry.path !== 'string' || !entry.path) continue;
    const shot =
      typeof entry.metadata?.shot_number === 'number'
        ? entry.metadata.shot_number
        : 0;
    out.push({ scene: entry.scene_number, shot, path: entry.path });
  }
  return out;
}

/**
 * Count distinct scenes and shots from a list of scene_image entries.
 * Shot identity is `(scene, shot)` since shot numbers reset per scene.
 */
export function countScenesAndShots(
  images: ManifestSceneImage[],
): { scenes: number; shots: number } {
  const sceneSet = new Set<number>();
  const shotSet = new Set<string>();
  for (const img of images) {
    sceneSet.add(img.scene);
    shotSet.add(`${img.scene}_${img.shot}`);
  }
  return { scenes: sceneSet.size, shots: shotSet.size };
}

/**
 * A parsed scene_video_prompt file as we care about it for thumbnail
 * selection — just shot purpose mapping. Extra fields ignored.
 */
export interface SVPShape {
  shots?: Array<{ shotNumber?: unknown; purpose?: unknown } | null | undefined>;
}

/**
 * From a collection of scene_video_prompt parses (keyed by scene
 * number), extract every `(scene, shot)` pair whose `purpose` is
 * `meet_character`. These are usually hero introductions and make
 * the most identifiable thumbnails.
 *
 * Returns a Set of `"<scene>_<shot>"` keys matching the format used
 * by `countScenesAndShots` so callers can membership-test directly.
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
