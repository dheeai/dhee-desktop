/**
 * LibraryOverlay — wraps VideoLibraryView with self-contained
 * playback state. The original component was designed to share
 * playback state with TimelinePanel inside PreviewPanel. As an
 * overlay it owns its own playback time + isPlaying, scoped to the
 * overlay's lifetime.
 */
import { useState } from 'react';
import VideoLibraryView from '../../components/preview/VideoLibraryView/VideoLibraryView';
import { useProject } from '../../contexts/ProjectContext';

export default function LibraryOverlay() {
  const { scenes } = useProject();
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <VideoLibraryView
      playbackTime={playbackTime}
      isPlaying={isPlaying}
      onPlaybackTimeChange={setPlaybackTime}
      onPlaybackStateChange={setIsPlaying}
      projectScenes={scenes}
    />
  );
}
