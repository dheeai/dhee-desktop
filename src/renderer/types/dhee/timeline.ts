/**
 * Timeline State (.dhee/ui/timeline.json)
 * Location: <ProjectName>/.dhee/ui/timeline.json
 * Owner: UI
 * Purpose: Persistence of timeline interaction state
 */

/**
 * Status of a timeline marker
 */
export type MarkerStatus = 'pending' | 'processing' | 'complete' | 'error';

/**
 * Track type for imported clips
 */
export type TrackType = 'main' | 'overlay';

/**
 * Timeline marker for prompt-based generation
 */
export interface TimelineMarker {
  /** Unique marker identifier */
  id: string;

  /** Position in seconds on the timeline */
  position_seconds: number;

  /** User prompt associated with this marker */
  prompt: string;

  /** Current processing status */
  status: MarkerStatus;

  /** Artifact ID of generated content (if complete) */
  generated_artifact_id?: string;

  /** ISO8601 timestamp of creation */
  created_at: string;
}

/**
 * Trim settings for imported clips
 */
export interface ClipTrim {
  /** In point in seconds */
  in_seconds: number;

  /** Out point in seconds */
  out_seconds: number;
}

/**
 * Imported video clip on the timeline
 */
export interface ImportedClip {
  /** Unique clip identifier */
  id: string;

  /** Path to the imported video file */
  path: string;

  /** Original duration in seconds */
  duration_seconds: number;

  /** Start time on the timeline in seconds */
  start_time_seconds: number;

  /** Optional trim settings */
  trim?: ClipTrim;

  /** Track assignment */
  track?: TrackType;
}

/**
 * Active versions for a scene (image and/or video)
 */
export interface SceneVersions {
  /** Active image version number */
  image?: number;
  /** Active video version number */
  video?: number;
}

/**
 * Per-video split settings (placement-based)
 */
export interface VideoSplitOverride {
  /** Split offsets in seconds from the source clip start */
  split_offsets_seconds: number[];
}

/**
 * Timeline state persistence
 */
export interface TimelineState {
  /** Schema version for migration support */
  schema_version: '1';

  /** Current playhead position in seconds */
  playhead_seconds: number;

  /** Current zoom level (1.0 = 100%) */
  zoom_level: number;

  /** Active versions for each scene (scene folder -> { image?: number, video?: number }) */
  active_versions: Record<string, SceneVersions | number>;

  /** Timeline markers for prompt-based generation */
  markers: TimelineMarker[];

  /** Imported video clips */
  imported_clips: ImportedClip[];

  /** Per-image timing overrides keyed by placement number string */
  image_timing_overrides: Record<
    string,
    {
      start_time_seconds: number;
      end_time_seconds: number;
    }
  >;

  /** Per-video split overrides keyed by placement number string */
  video_split_overrides: Record<string, VideoSplitOverride>;

  /** Per-segment timing overrides keyed by server timeline segment id */
  segment_timing_overrides: Record<
    string,
    {
      start_time_seconds: number;
      end_time_seconds: number;
    }
  >;
}

/**
 * Default timeline state
 */
export const DEFAULT_TIMELINE_STATE: TimelineState = {
  schema_version: '1',
  playhead_seconds: 0,
  zoom_level: 1.0,
  active_versions: {},
  markers: [],
  imported_clips: [],
  image_timing_overrides: {},
  video_split_overrides: {},
  segment_timing_overrides: {},
};

/**
 * Creates a new timeline marker
 */
export function createTimelineMarker(
  id: string,
  positionSeconds: number,
  prompt: string,
): TimelineMarker {
  return {
    id,
    position_seconds: positionSeconds,
    prompt,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
}

/**
 * Creates an imported clip
 */
export function createImportedClip(
  id: string,
  path: string,
  durationSeconds: number,
  startTimeSeconds: number = 0,
): ImportedClip {
  return {
    id,
    path,
    duration_seconds: durationSeconds,
    start_time_seconds: startTimeSeconds,
    track: 'main',
  };
}

/**
 * Updates the active version for a scene
 * Supports both old format (number) and new format (SceneVersions)
 */
export function setActiveVersion(
  state: TimelineState,
  sceneFolder: string,
  assetType: 'image' | 'video',
  version: number,
): TimelineState {
  const current = state.active_versions[sceneFolder];
  let updated: SceneVersions;

  // Handle migration from old format (number) to new format (SceneVersions)
  if (typeof current === 'number') {
    // Old format: migrate to new format
    updated =
      assetType === 'video'
        ? { video: version, image: current } // Preserve old video version as image if needed
        : { image: version, video: current }; // Preserve old video version
  } else if (current && typeof current === 'object') {
    // New format: update specific asset type
    updated = { ...current, [assetType]: version };
  } else {
    // No existing version: create new
    updated = { [assetType]: version };
  }

  return {
    ...state,
    active_versions: {
      ...state.active_versions,
      [sceneFolder]: updated,
    },
  };
}

/**
 * Gets the active version for a scene (defaults to 1)
 * Supports both old format (number) and new format (SceneVersions)
 */
export function getActiveVersion(
  state: TimelineState,
  sceneFolder: string,
  assetType: 'image' | 'video' = 'video',
): number {
  const versions = state.active_versions[sceneFolder];

  // Handle old format (number) - treat as video version
  if (typeof versions === 'number') {
    return assetType === 'video' ? versions : 1;
  }

  // Handle new format (SceneVersions)
  if (versions && typeof versions === 'object') {
    return versions[assetType] ?? 1;
  }

  return 1;
}
