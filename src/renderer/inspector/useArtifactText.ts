/**
 * Shared hook: read an artifact file from disk by its walker-relative
 * outputPath. Returns `{ text, status }` where status is 'loading' |
 * 'ok' | 'missing' | 'idle' so consumers can render appropriate
 * states.
 *
 * Lives outside of any specific kind renderer because every kind
 * (md/json/image/video/audio/text) needs the same projectDir
 * resolution + reactive re-read on outputPath change.
 *
 * Image / video / audio kinds usually use the file URL directly
 * (`file://${absPath}`) rather than reading bytes — those use
 * `useArtifactPath` (below) instead.
 */
import { useEffect, useState } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';

export type ArtifactStatus = 'idle' | 'loading' | 'ok' | 'missing';

export interface ArtifactText {
  text: string | null;
  status: ArtifactStatus;
}

export function useArtifactText(outputPath: string | undefined): ArtifactText {
  const { projectDirectory } = useWorkspace();
  const [state, setState] = useState<ArtifactText>({ text: null, status: 'idle' });

  useEffect(() => {
    if (!outputPath || !projectDirectory) {
      setState({ text: null, status: 'idle' });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'loading' }));
    (async () => {
      try {
        const raw = await window.electron.project.readFile(
          `${projectDirectory}/${outputPath}`,
        );
        if (cancelled) return;
        if (raw === null || raw === undefined) {
          setState({ text: null, status: 'missing' });
          return;
        }
        setState({ text: raw, status: 'ok' });
      } catch {
        if (!cancelled) setState({ text: null, status: 'missing' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outputPath, projectDirectory]);

  return state;
}

/**
 * For image / video / audio renderers — returns the absolute file://
 * URL so a native <img> / <video> / <audio> element can stream it.
 * Returns null when there's no projectDir or no outputPath.
 */
export function useArtifactUrl(outputPath: string | undefined): string | null {
  const { projectDirectory } = useWorkspace();
  if (!outputPath || !projectDirectory) return null;
  // The walker's outputPath is always projectDir-relative.
  return `file://${projectDirectory}/${outputPath}`;
}
