/* eslint-disable jsx-a11y/media-has-caption -- Review source media may not yet have a caption track; do not invent one. */
import { useEffect, useState } from 'react';
import type { ProductionReviewPreview as Preview } from '../../../shared/productionReview';
import { toFileUrl } from '../../utils/pathResolver';
import styles from './ProductionReviewPanel.module.scss';

export function ProductionReviewPreview({
  projectDir,
  preview,
  onLoaded,
}: {
  projectDir: string;
  preview: Preview;
  onLoaded: (key: string, loaded: boolean) => void;
}) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState('');
  const media = ['image', 'video', 'audio'].includes(preview.format);
  useEffect(() => {
    if (media) return undefined;
    let cancelled = false;
    window.electron.project
      .readFile(`${projectDir}/${preview.previewPath}`)
      .then((value) => {
        if (!cancelled) {
          setText(value ?? '');
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
  }, [projectDir, preview, media, onLoaded]);
  const fail = () => {
    setError('Could not load this review preview. Refresh to retry.');
    onLoaded(preview.key, false);
  };
  const src = toFileUrl(`${projectDir}/${preview.previewPath}`);
  return (
    <div className={styles.preview}>
      <strong>
        {preview.key} ({preview.versionId})
      </strong>
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
      {!media ? <pre>{text ?? 'Loading preview…'}</pre> : null}
    </div>
  );
}
export default ProductionReviewPreview;
