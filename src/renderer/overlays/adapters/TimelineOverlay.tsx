/**
 * TimelineOverlay — wraps TimelinePanel as a full-screen overlay
 * (replaces the old docked timeline inside PreviewPanel). The
 * panel's open/toggle/resize props don't really apply when it's
 * already filling the overlay frame; pass no-ops + isOpen=true so
 * the panel renders its contents.
 */
import { useState } from 'react';
import TimelinePanel from '../../components/preview/TimelinePanel/TimelinePanel';

export default function TimelineOverlay() {
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <TimelinePanel
      isOpen
      onToggle={() => {}}
      onResize={() => {}}
      playbackTime={playbackTime}
      isPlaying={isPlaying}
      onSeek={setPlaybackTime}
      onPlayPause={setIsPlaying}
    />
  );
}
