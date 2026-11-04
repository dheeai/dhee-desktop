import { useState } from 'react';
import { ReadableArtifactContent } from './ReadableArtifact';
import styles from './ProductionReviewPanel.module.scss';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const words = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;
const duration = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;

function SceneFrame({
  src,
  label,
}: {
  src: string | undefined;
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.sceneFrame}>
      {src && !failed ? (
        <img src={src} alt={label} onError={() => setFailed(true)} />
      ) : (
        <div className={styles.sceneFrameEmpty}>
          <span>STORYBOARD FRAME</span>
          <p>
            {failed
              ? 'Storyboard frame unavailable'
              : 'No linked storyboard frame'}
          </p>
        </div>
      )}
    </div>
  );
}

/** Presents saved scene data only; it neither infers media links nor records approval. */
export function SceneReviewDocument({
  content,
  outputPath,
  images,
}: {
  content: string;
  outputPath: string;
  images: ReadonlyArray<{ key: string; src: string }>;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = undefined;
  }
  if (
    !object(parsed) ||
    !Array.isArray(parsed.scenes) ||
    !parsed.scenes.length ||
    !parsed.scenes.every(object)
  ) {
    return (
      <ReadableArtifactContent content={content} outputPath={outputPath} />
    );
  }
  const scenes = parsed.scenes as Record<string, unknown>[];
  const durations = scenes.map((scene) => duration(scene.durationSec));
  const total = durations.every((seconds) => seconds !== undefined)
    ? durations.reduce<number>((sum, seconds) => sum + (seconds ?? 0), 0)
    : undefined;
  const imageFor = (scene: Record<string, unknown>) => {
    const key = words(scene.imagePreviewKey);
    const matches = key ? images.filter((image) => image.key === key) : [];
    return matches.length === 1 ? matches[0].src : undefined;
  };
  return (
    <section className={styles.sceneReview} aria-label="Storyboard scenes">
      <div className={styles.boardHero}>
        <span className={styles.boardEyebrow}>STORY & DIRECTION</span>
        <h3>{words(parsed.title) ?? 'The storyboard'}</h3>
        <p>
          Picture, voice and intention. Review the film one scene at a time.
        </p>
        <header className={styles.sceneOverview}>
          <span>{scenes.length} scenes</span>
          {total !== undefined && Number.isFinite(total) ? (
            <span>{Number(total.toFixed(2))}s planned</span>
          ) : null}
        </header>
      </div>
      {words(parsed.scope) ? (
        <p className={styles.sceneScope}>{words(parsed.scope)}</p>
      ) : null}
      <div className={styles.sceneList}>
        {scenes.map((scene, index) => (
          // Snapshot order is immutable and IDs may be absent or duplicated.
          // eslint-disable-next-line react/no-array-index-key
          <article className={styles.sceneReviewCard} key={index}>
            <header>
              <span className={styles.sceneNumber}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <h4>
                {words(scene.title) ??
                  words(scene.name) ??
                  `Scene ${index + 1}`}
              </h4>
              <span className={styles.sceneTiming}>
                {durations[index] === undefined
                  ? 'Timing not set'
                  : `${durations[index]}s`}
              </span>
            </header>
            <div className={styles.sceneBody}>
              <SceneFrame
                key={imageFor(scene) ?? 'unlinked'}
                src={imageFor(scene)}
                label={`Scene ${index + 1} storyboard frame`}
              />
              <div className={styles.sceneFields}>
                <div>
                  <h5>Narration</h5>
                  <p>{words(scene.narration) ?? 'Narration not provided'}</p>
                </div>
                <div>
                  <h5>Action</h5>
                  <p>
                    {words(scene.action) ??
                      words(scene.picture) ??
                      'Action not provided'}
                  </p>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
      <details className={styles.sceneDetails}>
        <summary>Details · full source and additional fields</summary>
        <pre>{content}</pre>
      </details>
    </section>
  );
}

export default SceneReviewDocument;
