/**
 * dhee Project Manifest (dhee.json)
 * Location: <ProjectName>/dhee.json
 * Owner: Frontend (UI)
 * Purpose: Defines top-level project metadata and default rendering configuration
 */

/**
 * Project resolution settings
 */
export interface ProjectResolution {
  width: number;
  height: number;
}

/**
 * Project rendering settings
 */
export interface ProjectSettings {
  resolution: ProjectResolution;
  framerate: number;
  aspect_ratio: string;
}

/**
 * Root project manifest interface
 * This is the human-readable project file at the root of the project directory
 */
export interface dheeManifest {
  /** Unique project identifier */
  id: string;

  /** Human-readable project name */
  name: string;

  /** Optional project description */
  description?: string;

  /** ISO8601 timestamp of project creation */
  created_at: string;

  /** ISO8601 timestamp of last update */
  updated_at: string;

  /** Rendering and output settings */
  settings: ProjectSettings;

  /** Schema version for migration support */
  schema_version: '1';

  /** dhee application version that created this project */
  dhee_version: string;
}

/**
 * Default project settings
 */
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  resolution: { width: 1920, height: 1080 },
  framerate: 30,
  aspect_ratio: '16:9',
};

/**
 * Creates a new dheeManifest with default values
 */
export function createDefaultManifest(
  id: string,
  name: string,
  dheeVersion: string,
): dheeManifest {
  const now = new Date().toISOString();
  return {
    id,
    name,
    created_at: now,
    updated_at: now,
    settings: DEFAULT_PROJECT_SETTINGS,
    schema_version: '1',
    dhee_version: dheeVersion,
  };
}
