import type { MediaCheckReport } from '../../../shared/mediaChecks';

function level(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1).replace('-', '−')} dBFS`
    : 'not available';
}

export function MediaMeasurements({
  media,
}: {
  media: MediaCheckReport['media'];
}) {
  if (!media) return null;
  return (
    <section aria-label="Measured media">
      <h4>Measured media</h4>
      {media.durationSec !== undefined && (
        <p>Duration: {media.durationSec.toFixed(3)} s</p>
      )}
      {media.video && (
        <p>
          {media.video.width} × {media.video.height} ·{' '}
          {media.video.fps ?? 'unknown'} fps
        </p>
      )}
      {media.audio && (
        <>
          <p>
            {media.audio.channels}{' '}
            {media.audio.channels === 1 ? 'channel' : 'channels'} ·{' '}
            {media.audio.sampleRate} Hz
          </p>
          <p>
            Peak {level(media.audio.peakDb)} · mean {level(media.audio.meanDb)}
          </p>
          <p>
            First audio track only. These measurements do not establish delivery
            loudness or voice identity.
          </p>
        </>
      )}
      {!!media.silenceIntervals?.length && (
        <>
          <h4>Silence to review</h4>
          <p>
            Times are in seconds from the checked file’s start. Listen in
            context: a pause may be intentional. Audio timestamps may extend
            slightly beyond the video duration.
          </p>
          <ul aria-label="Silence intervals">
            {media.silenceIntervals.map((interval) => (
              <li key={`${interval.start}:${interval.end ?? 'open'}`}>
                {interval.end === undefined
                  ? `${interval.start.toFixed(3)} s–end not detected`
                  : `${interval.start.toFixed(3)}–${interval.end.toFixed(3)} s`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
export default MediaMeasurements;
