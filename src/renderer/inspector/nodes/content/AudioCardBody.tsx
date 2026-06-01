/**
 * AudioCardBody — compact native audio player on the artifact's
 * file:// URL. Default browser controls keep this surface small.
 */
interface Props {
  projectDir: string | null;
  outputPath: string | null;
}

export function AudioCardBody({ projectDir, outputPath }: Props) {
  if (!projectDir || !outputPath) {
    return <div style={{ padding: 10, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>no audio</div>;
  }
  const src = `file://${projectDir}/${outputPath}`;
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
    >
      <audio src={src} controls style={{ width: '100%', maxWidth: 280 }} />
    </div>
  );
}
