/**
 * dhee Project Directory Types
 * Re-exports all types from the dhee/ folder
 *
 * Based on dhee Project Directory Specification v1.0 (December 12, 2025)
 */

// Common types and enums
export type {
  WorkflowPhase,
  PhaseStatus,
  PlannerStage,
  ItemApprovalStatus,
  ContentStatus,
  ContextSource,
} from './common';

export { SCHEMA_VERSION, AGENT_PROJECT_VERSION } from './common';

// Root manifest (dhee.json)
export type {
  dheeManifest,
  ProjectSettings,
  ProjectResolution,
} from './manifest';

export { DEFAULT_PROJECT_SETTINGS, createDefaultManifest } from './manifest';

// Entity types (characters, settings, scenes)
export type {
  CharacterData,
  SettingData,
  SceneRef,
  FinalVideoInfo,
} from './entities';

export {
  createDefaultCharacter,
  createDefaultSetting,
  createDefaultSceneRef,
} from './entities';

// Agent project file (.dhee/agent/project.json)
export type {
  AgentProjectFile,
  PhaseInfo,
  ContentEntry,
  ContentRegistry,
  WorkflowPhases,
} from './agentProject';

export {
  createDefaultPhaseInfo,
  createDefaultContentEntry,
  createDefaultWorkflowPhases,
  createDefaultContentRegistry,
  createDefaultAgentProject,
} from './agentProject';

// Asset manifest (.dhee/agent/manifest.json)
export type { AssetManifest, AssetInfo, AssetType } from './assetManifest';

export {
  createDefaultAssetManifest,
  createAssetInfo,
  getAssetsByType,
  getAssetsByScene,
  getLatestAsset,
} from './assetManifest';

// Timeline state (.dhee/ui/timeline.json)
export type {
  TimelineState as dheeTimelineState,
  TimelineMarker as dheeTimelineMarker,
  ImportedClip,
  ClipTrim,
  MarkerStatus,
  TrackType,
  SceneVersions,
} from './timeline';

export {
  DEFAULT_TIMELINE_STATE,
  createTimelineMarker,
  createImportedClip,
  setActiveVersion,
  getActiveVersion,
} from './timeline';

// Context index (.dhee/context/index.json)
export type { ContextIndex, StoredContextMeta } from './context';

export {
  createContextMeta,
  createDefaultContextIndex,
  upsertContextEntry,
  removeContextEntry,
  getContextEntries,
  getContextEntriesBySource,
} from './context';

/**
 * Complete project data structure for loading/saving
 */
export interface dheeProject {
  /** Root manifest (dhee.json) */
  manifest: import('./manifest').dheeManifest;

  /** Agent project state (.dhee/agent/project.json) */
  agentState: import('./agentProject').AgentProjectFile;

  /** Asset manifest (.dhee/agent/manifest.json) */
  assetManifest: import('./assetManifest').AssetManifest;

  /** Timeline state (.dhee/ui/timeline.json) */
  timelineState: import('./timeline').TimelineState;

  /** Context index (.dhee/context/index.json) */
  contextIndex: import('./context').ContextIndex;
}

/**
 * Project paths for file operations
 */
export const PROJECT_PATHS = {
  ROOT_MANIFEST: 'project.json',
  VIDEOS_IMPORTED: 'videos/imported',
  EXPORTS: 'exports',
  dhee_DIR: '.dhee',
  AGENT_DIR: '',
  AGENT_PROJECT: 'project.json',
  AGENT_MANIFEST: 'assets/manifest.json',
  AGENT_PLANS: 'plans',
  AGENT_CHARACTERS: 'characters',
  AGENT_SETTINGS: 'settings',
  AGENT_SCENES: 'scenes',
  AGENT_MUSIC: 'music',
  AGENT_AUDIO: 'assets/audio',
  AGENT_FINAL: 'final',
  UI_DIR: '',
  UI_TIMELINE: 'timeline-ui.json',
  CONTEXT_DIR: '',
  CONTEXT_INDEX: 'context-index.json',
  CONTEXT_CHUNKS: 'context-chunks',
} as const;
