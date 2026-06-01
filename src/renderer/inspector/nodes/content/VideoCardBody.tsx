/**
 * VideoCardBody — HTML5 video element pointed at the artifact's
 * file:// URL. `preload="metadata"` so we can show the first frame
 * + duration without buffering the whole clip. Muted + click-to-play.
 *
 * For 1080p LTX outputs the load cost is ~20-50ms per card. With 10+
 * shot videos on screen that's still snappy. If perf matters we can
 * add `loading="lazy"` semantics via Intersection Observer later.
 */
import { useRef, useState } from 'react';
import { cacheBustMediaSrc } from '../../../components/chat/ChatPanelEmbedded/mediaResolution';

interface Props {
  projectDir: string | null;
  outputPath: string | null;
  /** ms-timestamp from walkState.completedAt — cache-bust key. */
  completedAt?: number | null;
}

export function VideoCardBody({ projectDir, outputPath, completedAt }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [errored, setErrored] = useState(false);
  const [playing, setPlaying] = useState(false);

  if (!projectDir || !outputPath) {
    return <div style={{ padding: 10, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>no video</div>;
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
        video missing on disk
      </div>
    );
  }

  const togglePlay = (): void => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  return (
    <div style={{ flex: 1, position: 'relative', background: '#0c0d11', cursor: 'pointer' }} onClick={togglePlay}>
      <video
        ref={ref}
        src={src}
        preload="metadata"
        muted
        onError={() => setErrored(true)}
        onEnded={() => setPlaying(false)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
      {!playing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(22, 24, 33, 0.7)',
              border: '1.5px solid rgba(229, 225, 216, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#e5e1d8',
              fontSize: 14,
              paddingLeft: 3,
            }}
          >
            ▶
          </div>
        </div>
      )}
    </div>
  );
}
