/**
 * EmptyCardBody — fallback for non-completed instances or unknown
 * artifact formats. Shows the status and (when present) the failure
 * reason.
 */
interface Props {
  status: string;
  error: string | null | undefined;
  outputPath: string | null | undefined;
}

export function EmptyCardBody({ status, error, outputPath }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        gap: 6,
        textAlign: 'center',
      }}
    >
      {error ? (
        <>
          <div style={{ fontSize: 10, color: '#a56d6f', fontWeight: 600 }}>FAILED</div>
          <div style={{ fontSize: 10, color: 'rgba(165, 109, 111, 0.8)', lineHeight: 1.4 }}>
            {error.length > 160 ? error.slice(0, 160) + '…' : error}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 10, color: 'rgba(229, 225, 216, 0.5)' }}>
            {status === 'in_progress' ? 'running…' : status === 'invalidated' ? 'invalidated' : 'not yet generated'}
          </div>
          {outputPath && (
            <div
              style={{
                fontSize: 9,
                color: 'rgba(229, 225, 216, 0.3)',
                fontFamily: 'ui-monospace, Menlo, monospace',
                wordBreak: 'break-all',
              }}
            >
              {outputPath}
            </div>
          )}
        </>
      )}
    </div>
  );
}
