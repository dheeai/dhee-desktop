/**
 * ImageCardBody — inline image preview. Loads the artifact via
 * file:// URL (webSecurity is disabled in the BrowserWindow config
 * so this just works). Falls back to a placeholder on error.
 */
import { useState } from 'react';

interface Props {
  projectDir: string | null;
  outputPath: string | null;
}

export function ImageCardBody({ projectDir, outputPath }: Props) {
  const [errored, setErrored] = useState(false);
  if (!projectDir || !outputPath) {
    return <div style={{ padding: 10, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>no image</div>;
  }
  const src = `file://${projectDir}/${outputPath}`;
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
