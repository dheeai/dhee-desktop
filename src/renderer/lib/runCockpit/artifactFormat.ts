/**
 * Artifact-format classification by output-path extension — mirrors the
 * Inspector card-body dispatch so the deliverables strip and run model
 * agree on what an artifact is. Pure; see artifactFormat.test.ts.
 */
export type ArtifactFormat = 'image' | 'video' | 'audio' | 'json' | 'md' | 'unknown';

export function inferArtifactFormat(outputPath: string | undefined | null): ArtifactFormat {
  if (!outputPath) return 'unknown';
  const lower = outputPath.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|mov|mkv)$/.test(lower)) return 'video';
  if (/\.(wav|mp3|ogg|flac)$/.test(lower)) return 'audio';
  if (/\.json$/.test(lower)) return 'json';
  if (/\.(md|txt)$/.test(lower)) return 'md';
  return 'unknown';
}

/** Visual/audio media render as a thumbnail/preview; everything else does not. */
export function isPreviewable(format: string): boolean {
  return format === 'image' || format === 'video' || format === 'audio';
}
