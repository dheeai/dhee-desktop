/* eslint-disable jsx-a11y/media-has-caption -- Review source media may not yet have a caption track; do not invent one. */
import { useEffect, useState } from 'react';
import type { ProductionReviewPreview as Preview } from '../../../shared/productionReview';
import { toFileUrl } from '../../utils/pathResolver';
import { SceneReviewDocument } from './SceneReviewDocument';
import styles from './ProductionReviewPanel.module.scss';

export function ProductionReviewPreview({
  projectDir,
  preview,
  onLoaded,
  relatedPreviews = [],
}: {
  projectDir: string;
  preview: Preview;
  relatedPreviews?: Preview[];
  onLoaded: (key: string, loaded: boolean) => void;
}) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState('');
  const media = ['image', 'video', 'audio'].includes(preview.format);
  useEffect(() => {
    setText(undefined);
    setError('');
    onLoaded(preview.key, false);
    if (media) return undefined;
    let cancelled = false;
    window.electron.project
      .readFile(`${projectDir}/${preview.previewPath}`)
      .then((value) => {
        if (!cancelled) {
          if (!value?.trim()) throw Error('Empty review preview');
          setText(value);
          onLoaded(preview.key, true);
        }
        return undefined;
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load this review preview. Refresh to retry.');
          onLoaded(preview.key, false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    projectDir,
    preview.key,
    preview.previewPath,
    preview.versionId,
    preview.format,
    media,
    onLoaded,
  ]);
  const fail = () => {
    setError('Could not load this review preview. Refresh to retry.');
    onLoaded(preview.key, false);
  };
  const src = toFileUrl(`${projectDir}/${preview.previewPath}`);
  return (
    <div className={styles.preview}>
      <strong>{preview.key.replace(/_/g, ' ')}</strong>
      <details className={styles.previewVersion}>
        <summary>Version details</summary>
        <span>{preview.versionId}</span>
      </details>
      {error ? <p role="alert">{error}</p> : null}
      {preview.format === 'image' ? (
        <img
          src={src}
          alt={`${preview.key} (${preview.versionId})`}
          onLoad={() => onLoaded(preview.key, true)}
          onError={fail}
        />
      ) : null}
      {preview.format === 'video' ? (
        <video
          src={src}
          controls
          preload="metadata"
          aria-label={preview.key}
          onLoadedMetadata={() => onLoaded(preview.key, true)}
          onError={fail}
        />
      ) : null}
      {preview.format === 'audio' ? (
        <audio
          src={src}
          controls
          preload="metadata"
          aria-label={preview.key}
          onLoadedMetadata={() => onLoaded(preview.key, true)}
          onError={fail}
        />
      ) : null}
      {!media && !error && text === undefined ? <p>Loading preview…</p> : null}
      {!media && !error && text !== undefined ? (
        <>
          <div className={styles.previewDocument}>
            <SceneReviewDocument
              content={text}
              outputPath={preview.previewPath}
              images={relatedPreviews
                .filter((item) => item.format === 'image')
                .map((item) => ({
                  key: item.key,
                  src: toFileUrl(`${projectDir}/${item.previewPath}`),
                }))}
            />
          </div>
          {preview.format !== 'json' ? (
            <details>
              <summary>Inspect source</summary>
              <pre>{text}</pre>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
ProductionReviewPreview.defaultProps = { relatedPreviews: [] };

export default ProductionReviewPreview;
