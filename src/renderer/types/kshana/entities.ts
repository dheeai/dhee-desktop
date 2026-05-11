/**
 * Entity types for dhee Project Directory
 * Characters, Settings, Scenes, and related data structures
 */

import type { ItemApprovalStatus } from './common';

/**
 * Character data stored in .dhee/agent/project.json
 */
export interface CharacterData {
  /** Display name of the character */
  name: string;

  /** URL-safe slug for folder naming (e.g., "alice-chen") */
  slug: string;

  /** Character description and backstory */
  description: string;

  /** Visual appearance description for image generation */
  visual_description: string;

  /** Approval status for character definition */
  approval_status: ItemApprovalStatus;

  /** Approval status for reference image */
  reference_image_approval_status?: ItemApprovalStatus;

  /** Artifact ID for character content */
  content_artifact_id?: string;

  /** Artifact ID for reference image */
  reference_image_id?: string;

  /** Path to reference image file */
  reference_image_path?: string;

  /** Timestamp when character was approved */
  approved_at?: number;

  /** Timestamp when reference image was approved */
  reference_image_approved_at?: number;

  /** Number of times this character has been regenerated */
  regeneration_count: number;
}

/**
 * Setting/Location data stored in .dhee/agent/project.json
 */
export interface SettingData {
  /** Display name of the setting */
  name: string;

  /** URL-safe slug for folder naming (e.g., "dusty-village") */
  slug: string;

  /** Setting description */
  description: string;

  /** Visual description for image generation */
  visual_description: string;

  /** Approval status for setting definition */
  approval_status: ItemApprovalStatus;

  /** Approval status for reference image */
  reference_image_approval_status?: ItemApprovalStatus;

  /** Artifact ID for setting content */
  content_artifact_id?: string;

  /** Artifact ID for reference image */
  reference_image_id?: string;

  /** Path to reference image file */
  reference_image_path?: string;

  /** Timestamp when setting was approved */
  approved_at?: number;

  /** Timestamp when reference image was approved */
  reference_image_approved_at?: number;

  /** Number of times this setting has been regenerated */
  regeneration_count: number;
}

/**
 * Scene reference in project.json
 * Contains metadata and approval states for a scene
 */
export interface SceneRef {
  /** Scene number (1-indexed, zero-padded in folder names) */
  scene_number: number;

  /** Folder path relative to .dhee/agent/scenes/ */
  folder: string;

  /** Optional scene title */
  title?: string;

  /** Scene description */
  description?: string;

  // === Scene Content ===

  /** Approval status for scene content/script */
  content_approval_status: ItemApprovalStatus;

  /** Artifact ID for scene content */
  content_artifact_id?: string;

  /** Timestamp when content was approved */
  content_approved_at?: number;

  // === Scene Image ===

  /** Approval status for scene keyframe/storyboard image */
  image_approval_status: ItemApprovalStatus;

  /** Artifact ID for scene image */
  image_artifact_id?: string;

  /** Path to scene image file */
  image_path?: string;

  /** Prompt used to generate the image */
  image_prompt?: string;

  /** Timestamp when image was approved */
  image_approved_at?: number;

  // === Scene Video ===

  /** Approval status for generated video */
  video_approval_status: ItemApprovalStatus;

  /** Artifact ID for scene video */
  video_artifact_id?: string;

  /** Path to active video version */
  video_path?: string;

  /** Timestamp when video was approved */
  video_approved_at?: number;

  // === Scene Audio ===

  /** Approval status for scene audio mix */
  audio_approval_status?: ItemApprovalStatus;

  /** Artifact ID for audio mix */
  audio_mix_artifact_id?: string;

  /** Path to audio mix file */
  audio_mix_path?: string;

  /** Timestamp when audio was approved */
  audio_approved_at?: number;

  // === Captions/Transcript ===

  /** Artifact ID for transcript */
  transcript_artifact_id?: string;

  /** Path to transcript file */
  transcript_path?: string;

  /** Artifact ID for captions (VTT) */
  caption_artifact_id?: string;

  /** Path to caption file */
  caption_path?: string;

  // === Metadata ===

  /** Number of times this scene has been regenerated */
  regeneration_count: number;

  /** User feedback for regeneration */
  feedback?: string;
}

/**
 * Final video information
 */
export interface FinalVideoInfo {
  /** Artifact ID for final video */
  artifact_id: string;

  /** Path to final video file */
  path: string;

  /** Duration in seconds */
  duration: number;

  /** Unix timestamp of creation */
  created_at: number;
}

/**
 * Creates a default CharacterData object
 */
export function createDefaultCharacter(
  name: string,
  slug: string,
): CharacterData {
  return {
    name,
    slug,
    description: '',
    visual_description: '',
    approval_status: 'pending',
    regeneration_count: 0,
  };
}

/**
 * Creates a default SettingData object
 */
export function createDefaultSetting(name: string, slug: string): SettingData {
  return {
    name,
    slug,
    description: '',
    visual_description: '',
    approval_status: 'pending',
    regeneration_count: 0,
  };
}

/**
 * Creates a default SceneRef object
 */
export function createDefaultSceneRef(sceneNumber: number): SceneRef {
  const paddedNum = String(sceneNumber).padStart(3, '0');
  return {
    scene_number: sceneNumber,
    folder: `scene-${paddedNum}`,
    content_approval_status: 'pending',
    image_approval_status: 'pending',
    video_approval_status: 'pending',
    regeneration_count: 0,
  };
}
