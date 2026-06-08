/**
 * sceneGroups — group a stage's instances the way a director reads them.
 *
 * Shot/clip item ids in narrative bundles encode their scene
 * (e.g. `scene_1_shot_3`). The Production View renders those as per-scene
 * film-strips. Items that don't encode a scene (character/setting
 * references, or non-narrative bundles) collapse to a single group the
 * view renders as a flat reference board. Pure; bundle-agnostic. See
 * sceneGroups.test.ts.
 */

/** Parse the scene number out of an item id, or null if none is encoded. */
export function parseSceneNo(itemId: string | undefined | null): number | null {
  if (!itemId) return null;
  const m = /scene[_\-]?(\d+)/i.exec(itemId);
  return m ? Number(m[1]) : null;
}

/** Parse the shot number out of an item id, or null. */
export function parseShotNo(itemId: string | undefined | null): number | null {
  if (!itemId) return null;
  const m = /shot[_\-]?(\d+)/i.exec(itemId);
  return m ? Number(m[1]) : null;
}

export interface SceneGroup<T> {
  key: string;
  label: string;
  /** null when the items don't encode scenes (→ flat board). */
  sceneNo: number | null;
  items: T[];
}

/**
 * Group items by scene number (ascending), shots ordered numerically
 * within a scene. Items without a scene collapse into one trailing group
 * (key 'ungrouped') — the signal to render a flat board instead of strips.
 */
export function groupByScene<T extends { itemId?: string }>(items: T[]): Array<SceneGroup<T>> {
  const byScene = new Map<number, T[]>();
  const ungrouped: T[] = [];
  for (const it of items) {
    const sn = parseSceneNo(it.itemId);
    if (sn === null) {
      ungrouped.push(it);
    } else {
      const list = byScene.get(sn) ?? [];
      list.push(it);
      byScene.set(sn, list);
    }
  }
  const groups: Array<SceneGroup<T>> = [];
  for (const sn of [...byScene.keys()].sort((a, b) => a - b)) {
    const arr = byScene.get(sn)!.slice().sort((a, b) => {
      const sa = parseShotNo(a.itemId);
      const sb = parseShotNo(b.itemId);
      if (sa !== null && sb !== null) return sa - sb;
      return (a.itemId ?? '').localeCompare(b.itemId ?? '');
    });
    groups.push({ key: `scene-${sn}`, label: `Scene ${sn}`, sceneNo: sn, items: arr });
  }
  if (ungrouped.length > 0) {
    groups.push({ key: 'ungrouped', label: 'All', sceneNo: null, items: ungrouped });
  }
  return groups;
}

/** True when the grouping yielded real per-scene strips (vs one flat board). */
export function hasScenes<T>(groups: Array<SceneGroup<T>>): boolean {
  return groups.some((g) => g.sceneNo !== null);
}
