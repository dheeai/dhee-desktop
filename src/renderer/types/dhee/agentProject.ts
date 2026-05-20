/**
 * Agent Project File (.dhee/agent/project.json)
 * Location: <ProjectName>/.dhee/agent/project.json
 * Owner: Agent (dhee-core)
 * Purpose: Central registry for workflow state, per-entity indexes, and approval metadata
 */

import type {
  WorkflowPhase,
  PhaseStatus,
  PlannerStage,
  ContentStatus,
} from './common';
import type {
  CharacterData,
  SettingData,
  SceneRef,
  FinalVideoInfo,
} from './entities';

/**
 * Phase information tracking
 */
export interface PhaseInfo {
  /** Current status of the phase */
  status: PhaseStatus;

  /** Stage within the planning process */
  planner_stage?: PlannerStage;

  /** Path to the plan file for this phase */
  plan_file?: string;

  /** Unix timestamp when phase was completed (null if not completed) */
  completed_at: number | null;

  /** Number of refinement iterations */
  refinement_count?: number;
}

/**
 * Content entry in the content registry
 */
export interface ContentEntry {
  /** Availability status of the content */
  status: ContentStatus;

  /** Path to the main content file */
  file: string;

  /** List of item identifiers */
  items?: string[];

  /** Mapping of item IDs to file paths */
  item_files?: Record<string, string>;
}

/**
 * Content registry tracking all generated content
 */
export interface ContentRegistry {
  plot: ContentEntry;
  story: ContentEntry;
  characters: ContentEntry;
  settings: ContentEntry;
  scenes: ContentEntry;
  images: ContentEntry;
  videos: ContentEntry;
  audio: ContentEntry;
  captions: ContentEntry;
}

/**
 * All workflow phases configuration
 * Includes both YouTube workflow phases and legacy story workflow phases
 */
export interface WorkflowPhases {
  // YouTube workflow phases
  transcript_input: PhaseInfo;
  planning: PhaseInfo;
  image_placement: PhaseInfo;
  image_generation: PhaseInfo;
  video_placement: PhaseInfo;
  video_generation: PhaseInfo;
  video_replacement: PhaseInfo;
  // Legacy story workflow phases
  plot: PhaseInfo;
  story: PhaseInfo;
  characters_settings: PhaseInfo;
  scenes: PhaseInfo;
  character_setting_images: PhaseInfo;
  scene_images: PhaseInfo;
  video: PhaseInfo;
  video_combine: PhaseInfo;
}

/**
 * Agent Project File - Central state for the AI agent
 */
export interface AgentProjectFile {
  /** Schema version for migration support */
  version: '2.0';

  /** Project identifier */
  id: string;

  /** Project title */
  title: string;

  /** Path to original user input file */
  original_input_file: string;

  /** Unix timestamp of creation */
  created_at: number;

  /** Unix timestamp of last update */
  updated_at: number;

  /** Current active workflow phase */
  current_phase: WorkflowPhase;

  /** Status of all workflow phases */
  phases: WorkflowPhases;

  /** Content registry tracking all generated content */
  content: ContentRegistry;

  /** List of characters in the project */
  characters: CharacterData[];

  /** List of settings/locations in the project */
  settings: SettingData[];

  /** List of scene references */
  scenes: SceneRef[];

  /** List of asset IDs */
  assets: string[];

  /** Final video information (if completed) */
  final_video?: FinalVideoInfo;
}

/**
 * Creates a default PhaseInfo object
 */
export function createDefaultPhaseInfo(): PhaseInfo {
  return {
    status: 'pending',
    completed_at: null,
  };
}

/**
 * Creates a default ContentEntry object
 */
export function createDefaultContentEntry(file: string): ContentEntry {
  return {
    status: 'missing',
    file,
  };
}

/**
 * Creates default workflow phases
 * Includes both YouTube workflow phases and legacy story workflow phases
 */
export function createDefaultWorkflowPhases(): WorkflowPhases {
  return {
    // YouTube workflow phases
    transcript_input: createDefaultPhaseInfo(),
    planning: createDefaultPhaseInfo(),
    image_placement: createDefaultPhaseInfo(),
    image_generation: createDefaultPhaseInfo(),
    video_placement: createDefaultPhaseInfo(),
    video_generation: createDefaultPhaseInfo(),
    video_replacement: createDefaultPhaseInfo(),
    // Legacy story workflow phases
    plot: createDefaultPhaseInfo(),
    story: createDefaultPhaseInfo(),
    characters_settings: createDefaultPhaseInfo(),
    scenes: createDefaultPhaseInfo(),
    character_setting_images: createDefaultPhaseInfo(),
    scene_images: createDefaultPhaseInfo(),
    video: createDefaultPhaseInfo(),
    video_combine: createDefaultPhaseInfo(),
  };
}

/**
 * Creates default content registry
 */
export function createDefaultContentRegistry(): ContentRegistry {
  return {
    plot: createDefaultContentEntry('plans/plot.md'),
    story: createDefaultContentEntry('plans/story.md'),
    characters: createDefaultContentEntry('plans/characters.md'),
    settings: createDefaultContentEntry('plans/settings.md'),
    scenes: createDefaultContentEntry('plans/scenes.md'),
    images: createDefaultContentEntry(''),
    videos: createDefaultContentEntry(''),
    audio: createDefaultContentEntry(''),
    captions: createDefaultContentEntry(''),
  };
}

/**
 * Creates a new AgentProjectFile with default values
 */
export function createDefaultAgentProject(
  id: string,
  title: string,
): AgentProjectFile {
  const now = Date.now();
  return {
    version: '2.0',
    id,
    title,
    original_input_file: 'original_input.md',
    created_at: now,
    updated_at: now,
    current_phase: 'plot',
    phases: createDefaultWorkflowPhases(),
    content: createDefaultContentRegistry(),
    characters: [],
    settings: [],
    scenes: [],
    assets: [],
  };
}
