/**
 * Types for dhee Project State (.dhee/project.json)
 * Mirrors the backend data structures
 */

export interface Character {
  name: string;
  description: string;
  appearance?: string;
  reference_image?: string;
  first_scene?: number;
}

export interface Location {
  name: string;
  description: string;
  reference_image?: string;
  first_scene?: number;
}

export interface Artifact {
  artifact_id: string;
  artifact_type: string; // "image", "video", "storyboard", "base_character", "base_setting"
  file_path: string;
  scene_number?: number;
  shot_number?: number;
  base_assets_used?: string[];
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface StoryboardScene {
  scene_number: number;
  name?: string;
  description: string;
  characters?: string[];
  location?: string;
  mood?: string;
  duration?: number;
  shot_type?: string;
  lighting?: string;
}

export interface StoryboardOutline {
  title?: string;
  scenes: StoryboardScene[];
  total_scenes?: number;
}

export interface CharacterDetails {
  character_name: string;
  role?: string;
  age?: number;
  appearance?: string;
  personality?: string;
  backstory?: string;
  visual_description?: string;
}

export interface SettingDetails {
  name: string;
  description?: string;
  atmosphere?: string;
  time_of_day?: string;
  weather?: string;
  key_elements?: string[];
}

export interface ProjectState {
  // Identity
  project_id: string;
  project_name?: string;
  created_at: string;
  updated_at: string;

  // Workflow state
  phase: string;
  current_scene?: number;
  current_shot?: string;

  // Content
  story_text?: string;
  story_info?: Record<string, unknown>;
  storyboard_outline?: StoryboardOutline;

  // Assets
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  artifacts: Artifact[];

  // Base Assets (reference images)
  character_assets: Record<string, string>; // {character_name: artifact_id}
  setting_assets: Record<string, string>; // {setting_name: artifact_id}

  // Structured info
  character_details: Record<string, CharacterDetails>;
  setting_details?: SettingDetails;
}

// Mock data for Props (backend doesn't support yet)
export interface PropAsset {
  id: string;
  name: string;
  description: string;
  category: 'clothing' | 'accessory' | 'item' | 'vehicle' | 'other';
  image_path?: string;
}

export const MOCK_PROPS: PropAsset[] = [
  {
    id: 'prop_001',
    name: 'Leather Backpack',
    description: 'Worn brown leather backpack with multiple pockets',
    category: 'accessory',
  },
  {
    id: 'prop_002',
    name: 'Straw Hat',
    description: 'Wide-brimmed straw hat for sun protection',
    category: 'clothing',
  },
  {
    id: 'prop_003',
    name: 'Compass',
    description: 'Vintage brass compass with leather strap',
    category: 'item',
  },
  {
    id: 'prop_004',
    name: 'Lantern',
    description: 'Oil lantern with brass frame',
    category: 'item',
  },
];

export interface TimelineMarker {
  id: string;
  position: number; // milliseconds or frame number
  prompt: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  generatedArtifactId?: string;
  createdAt: string;
}

export interface TimelineState {
  markers: TimelineMarker[];
  currentPosition: number;
  zoomLevel: number;
}
