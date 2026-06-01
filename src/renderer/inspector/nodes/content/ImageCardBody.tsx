/**
 * ImageCardBody — inline image preview. Loads the artifact via
 * file:// URL (webSecurity is disabled in the BrowserWindow config
 * so this just works). Falls back to a placeholder on error.
 *
 * `completedAt` (when known from the projection) is appended as a
 * `?v=` cache-buster so the renderer refetches when the canonical
 * artifact has been overwritten since the card was last rendered.
 */
import { useState } from 'react';
import { cacheBustMediaSrc } from '../../../components/chat/ChatPanelEmbedded/mediaResolution';

interface Props {
  projectDir: string | null;
  outputPath: string | null;
  /** ms-timestamp from walkState.completedAt. Used as cache-bust key. */
  completedAt?: number | null;
}

export function ImageCardBody({ projectDir, outputPath, completedAt }: Props) {
  const [errored, setErrored] = useState(false);
  if (!projectDir || !outputPath) {
    return <div style={{ padding: 10, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>no image</div>;
  }
  const src = cacheBustMediaSrc(`file://${projectDir}/${outputPath}`, completedAt ?? null);
  if (errored) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(165, 109, 111, 0.08)',
          color: '#a56d6f',
          fontSize: 10,
        }}
      >
        image missing on disk
      </div>
    );
  }
  return (
    <div style={{ flex: 1, position: 'relative', background: '#0c0d11', overflow: 'hidden' }}>
      <img
        src={src}
        alt={outputPath}
        onError={() => setErrored(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  );
}
