/* eslint-disable compat/compat -- This UI runs in Electron with native Promise support. */
import { useEffect, useId, useMemo, useState } from 'react';
import type { BundleSnapshot } from '../../lib/bundleCapability';
import { toFileUrl } from '../../utils/pathResolver';
import styles from './ProductionEditingPanel.module.scss';

type Scene = Record<string, unknown>;
type Document = Record<string, unknown> & { scenes: Scene[] };
function parse(content: string): Document | undefined {
  try {
    const value = JSON.parse(content);
    if (
      value &&
      !Array.isArray(value) &&
      Array.isArray(value.scenes) &&
      value.scenes.length &&
      value.scenes.every(
        (scene: unknown) =>
          scene && typeof scene === 'object' && !Array.isArray(scene),
      )
    )
      return value;
  } catch {
    /* Raw text editing remains available for incomplete JSON. */
  }
  return undefined;
}
type Reference = { id: string; label: string; src?: string; error?: string };
function Thumbnail({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p>Image preview unavailable. Check the reference before saving.</p>
  ) : (
    <img
      src={src}
      alt="Selected scene reference"
      onError={() => setFailed(true)}
    />
  );
}

/** Draft-only choices. Core preview/save owns dependency versions and approval invalidation. */
export function SceneImageLinkEditor({
  projectDir,
  nodeId,
  bundle,
  content,
  onChange,
  editImage,
}: {
  projectDir: string;
  nodeId: string;
  bundle: BundleSnapshot | null;
  content: string;
  onChange: (content: string) => void;
  editImage?: {
    nodeIds: string[];
    disabled: boolean;
    onSelect: (nodeId: string) => void;
  };
}) {
  const id = useId();
  const document = useMemo(() => parse(content), [content]);
  const candidates = useMemo(() => {
    const nodes = bundle?.nodes ?? [];
    const inputs = nodes.find((node) => node.id === nodeId)?.inputs ?? [];
    return nodes
      .filter(
        (node) =>
          node.kind === 'stage' &&
          node.outputs.format === 'image' &&
          inputs.some((input) => input.from === node.id) &&
          nodes.filter((n) => n.id === node.id).length === 1,
      )
      .map((node) => ({
        id: node.id,
        label: node.displayName ?? node.id.replace(/_/g, ' '),
      }));
  }, [bundle, nodeId]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(false);
  const valid = document !== undefined;
  useEffect(() => {
    let cancelled = false;
    setReferences([]);
    setLoading(valid && candidates.length > 0);
    if (!valid || !candidates.length) return undefined;
    Promise.all(
      candidates.map(async (candidate): Promise<Reference> => {
        try {
          const result = await window.dhee.productionEditing({
            action: 'artifact.read',
            projectDir,
            nodeId: candidate.id,
          });
          if (!result.ok) throw Error(result.error);
          if (!result.result.absolutePath || !result.result.sha256)
            throw Error('No current image available');
          return {
            ...candidate,
            src: `${toFileUrl(result.result.absolutePath)}?v=${result.result.sha256}`,
          };
        } catch (error) {
          return {
            ...candidate,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    )
      .then((result) => {
        if (!cancelled) {
          setReferences(result);
          setLoading(false);
        }
        return undefined;
      })
      .catch(() => {
        if (!cancelled) {
          setReferences(
            candidates.map((candidate) => ({
              ...candidate,
              error: 'Could not load reference',
            })),
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectDir, candidates, valid]);
  if (!document) return null;
  const updateScene = (index: number, changes: (scene: Scene) => Scene) => {
    const scenes = document.scenes.map((scene, i) =>
      i === index ? changes(scene) : scene,
    );
    onChange(JSON.stringify({ ...document, scenes }, null, 2));
  };
  const choose = (index: number, key: string) => {
    if (
      key &&
      !references.some((reference) => reference.id === key && reference.src)
    )
      return;
    updateScene(index, (scene) => {
      const updated = { ...scene };
      if (key) updated.imagePreviewKey = key;
      else delete updated.imagePreviewKey;
      return updated;
    });
  };
  return (
    <section className={styles.sceneLinks} aria-label="Storyboard scene editor">
      <h4>Storyboard scenes</h4>
      <p>
        Edit narration and action, and choose an image for each scene. Preview
        and save your changes below, then review the updated storyboard.
      </p>
      {!candidates.length ? (
        <p>
          This storyboard has no upstream image inputs. Add image inputs to its
          workflow before linking references here.
        </p>
      ) : null}
      {editImage?.disabled ? (
        <p>Save your storyboard changes before editing image files.</p>
      ) : null}
      {editImage &&
      candidates.some((candidate) =>
        editImage.nodeIds.includes(candidate.id),
      ) ? (
        <details>
          <summary>Add or replace image files</summary>
          <p>
            Choose a declared image input, then pick a file and preview its
            impact before saving.
          </p>
          {candidates
            .filter((candidate) => editImage.nodeIds.includes(candidate.id))
            .map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                disabled={editImage.disabled}
                onClick={() => editImage.onSelect(candidate.id)}
              >
                Edit {candidate.label} image file
              </button>
            ))}
        </details>
      ) : null}
      {loading ? <p role="status">Loading scene references…</p> : null}
      {references
        .filter((r) => r.error)
        .map((r) => (
          <p key={r.id}>
            {r.label}: {r.error}
          </p>
        ))}
      {document.scenes.map((scene, index) => {
        const current =
          typeof scene.imagePreviewKey === 'string'
            ? scene.imagePreviewKey
            : '';
        const selected = references.find(
          (reference) => reference.id === current,
        );
        return (
          // Scenes can lack IDs or repeat them; selections preserve document order.
          // eslint-disable-next-line react/no-array-index-key
          <div key={index} className={styles.sceneLink}>
            <h5>Scene {index + 1}</h5>
            <div className={styles.sceneTextFields}>
              {(
                [
                  'narration',
                  scene.action === undefined && scene.picture !== undefined
                    ? 'picture'
                    : 'action',
                ] as const
              ).map((field) => {
                const label = field === 'narration' ? 'Narration' : 'Action';
                const value = scene[field];
                if (value !== undefined && typeof value !== 'string')
                  return (
                    <p key={field}>
                      {label} uses structured data. Edit it in the source below.
                    </p>
                  );
                return (
                  <label key={field} htmlFor={`${id}-${index}-${field}`}>
                    {label}
                    <textarea
                      id={`${id}-${index}-${field}`}
                      aria-label={`${label} for scene ${index + 1}`}
                      rows={3}
                      value={value ?? ''}
                      onChange={(event) =>
                        updateScene(index, (prior) => ({
                          ...prior,
                          [field]: event.target.value,
                        }))
                      }
                    />
                  </label>
                );
              })}
            </div>
            <label htmlFor={`${id}-${index}`}>
              Image for scene {index + 1}
              <select
                id={`${id}-${index}`}
                aria-label={`Image for scene ${index + 1}`}
                value={current}
                disabled={loading}
                onChange={(event) => choose(index, event.target.value)}
              >
                <option value="">No image linked</option>
                {current &&
                !references.some((r) => r.id === current && r.src) ? (
                  <option value={current} disabled>
                    {current} · unavailable
                  </option>
                ) : null}
                {references
                  .filter((r) => r.src)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
              </select>
            </label>
            {editImage?.nodeIds.includes(current) ? (
              <button
                type="button"
                disabled={editImage.disabled}
                onClick={() => editImage.onSelect(current)}
              >
                Replace image for scene {index + 1}
              </button>
            ) : null}
            {selected?.src ? (
              <Thumbnail key={selected.src} src={selected.src} />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

SceneImageLinkEditor.defaultProps = { editImage: undefined };

export default SceneImageLinkEditor;
