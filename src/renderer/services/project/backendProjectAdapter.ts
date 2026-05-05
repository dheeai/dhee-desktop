import type {
  AgentProjectFile,
  AssetManifest,
  CharacterData,
  ItemApprovalStatus,
  KshanaManifest,
  SceneRef,
  SettingData,
} from '../../types/kshana';
import {
  createDefaultContentRegistry,
  createDefaultManifest,
  createDefaultWorkflowPhases,
} from '../../types/kshana';

export interface BackendPhaseInfo {
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  plannerStage?: 'planning' | 'verify' | 'refining' | 'complete';
  planFile?: string;
  startedAt?: number;
  completedAt: number | null;
  refinementCount?: number;
}

export interface BackendContentEntry {
  status: 'available' | 'partial' | 'missing';
  file?: string;
  items?: string[];
  itemFiles?: Record<string, string>;
}

export interface BackendCharacterData {
  name: string;
  description: string;
  visualDescription: string;
  approvalStatus: ItemApprovalStatus;
  referenceImageApprovalStatus?: ItemApprovalStatus;
  contentArtifactId?: string;
  referenceImageId?: string;
  referenceImagePath?: string;
  approvedAt?: number;
  referenceImageApprovedAt?: number;
  regenerationCount: number;
  imagePromptPath?: string;
  imagePromptApprovalStatus?: ItemApprovalStatus;
}

export interface BackendSettingData extends BackendCharacterData {}

export interface BackendSceneRef {
  sceneNumber: number;
  file?: string;
  title?: string;
  description?: string;
  contentApprovalStatus: ItemApprovalStatus;
  contentArtifactId?: string;
  contentApprovedAt?: number;
  imagePromptPath?: string;
  imagePromptApprovalStatus?: ItemApprovalStatus;
  imageApprovalStatus: ItemApprovalStatus;
  imageArtifactId?: string;
  imagePrompt?: string;
  imageApprovedAt?: number;
  videoPromptPath?: string;
  videoPromptApprovalStatus?: ItemApprovalStatus;
  videoApprovalStatus: ItemApprovalStatus;
  videoArtifactId?: string;
  videoApprovedAt?: number;
  regenerationCount: number;
  feedback?: string;
}

export interface BackendProjectFile {
  version: '2.0';
  id: string;
  title: string;
  description?: string;
  originalInputFile: string;
  style: string;
  inputType: 'idea' | 'story' | 'multi_input';
  createdAt: number;
  updatedAt: number;
  currentPhase: string;
  templateId?: string;
  phases: Record<string, BackendPhaseInfo>;
  content: {
    plot: BackendContentEntry;
    story: BackendContentEntry;
    characters: BackendContentEntry;
    settings: BackendContentEntry;
    scenes: BackendContentEntry;
    images: BackendContentEntry;
    videos: BackendContentEntry;
  };
  characters: BackendCharacterData[];
  settings: BackendSettingData[];
  scenes: BackendSceneRef[];
  assets: string[];
  finalVideo?: {
    artifactId: string;
    path: string;
    duration: number;
    createdAt: number;
  };
  productionStartedAt?: number;
  productionCompletedAt?: number;
  lastCheckpointAt?: number;
  targetDuration?: number;
  duration?: number;
  autonomousMode?: boolean;
}

export interface BackendAssetManifest {
  assets: Array<{
    id: string;
    type: string;
    path: string;
    createdAt?: number;
    created_at?: number;
    version?: number;
    scene_number?: number;
    entity_slug?: string;
    metadata?: Record<string, unknown>;
  }>;
  schema_version?: string;
}

export function normalizeBackendProjectForWrite(
  project: BackendProjectFile,
): BackendProjectFile {
  return {
    version: project.version,
    id: project.id,
    title: project.title,
    ...(project.description ? { description: project.description } : {}),
    originalInputFile: project.originalInputFile,
    style: project.style,
    inputType: project.inputType,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    currentPhase: project.currentPhase,
    ...(project.templateId ? { templateId: project.templateId } : {}),
    ...(typeof project.targetDuration === 'number'
      ? { targetDuration: project.targetDuration }
      : {}),
    ...(typeof project.duration === 'number'
      ? { duration: project.duration }
      : {}),
    ...(typeof project.autonomousMode === 'boolean'
      ? { autonomousMode: project.autonomousMode }
      : {}),
    phases: project.phases,
    content: project.content,
    characters: project.characters,
    settings: project.settings,
    scenes: project.scenes,
    assets: project.assets,
    ...(project.finalVideo ? { finalVideo: project.finalVideo } : {}),
    ...(typeof project.productionStartedAt === 'number'
      ? { productionStartedAt: project.productionStartedAt }
      : {}),
    ...(typeof project.productionCompletedAt === 'number'
      ? { productionCompletedAt: project.productionCompletedAt }
      : {}),
    ...(typeof project.lastCheckpointAt === 'number'
      ? { lastCheckpointAt: project.lastCheckpointAt }
      : {}),
    ...('elapsedMs' in (project as unknown as Record<string, unknown>)
      ? { elapsedMs: (project as unknown as Record<string, unknown>)['elapsedMs'] as number | undefined }
      : {}),
    ...('timerLastStartedAt' in (project as unknown as Record<string, unknown>)
      ? {
          timerLastStartedAt: (project as unknown as Record<string, unknown>)['timerLastStartedAt'] as
            | number
            | undefined,
        }
      : {}),
    ...('files' in (project as unknown as Record<string, unknown>)
      ? { files: (project as unknown as Record<string, unknown>)['files'] as unknown }
      : {}),
    ...('artifacts' in (project as unknown as Record<string, unknown>)
      ? { artifacts: (project as unknown as Record<string, unknown>)['artifacts'] as unknown }
      : {}),
    ...('goal' in (project as unknown as Record<string, unknown>)
      ? { goal: (project as unknown as Record<string, unknown>)['goal'] as unknown }
      : {}),
    ...('todos' in (project as unknown as Record<string, unknown>)
      ? { todos: (project as unknown as Record<string, unknown>)['todos'] as unknown }
      : {}),
    ...('inputs' in (project as unknown as Record<string, unknown>)
      ? { inputs: (project as unknown as Record<string, unknown>)['inputs'] as unknown }
      : {}),
    ...('primaryNarration' in (project as unknown as Record<string, unknown>)
      ? {
          primaryNarration: (project as unknown as Record<string, unknown>)['primaryNarration'] as unknown,
        }
      : {}),
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function toDesktopContent(
  content: BackendProjectFile['content'] | undefined | null,
): AgentProjectFile['content'] {
  const defaults = createDefaultContentRegistry();
  // v3.0 projects don't carry the legacy content registry — return
  // defaults rather than crashing on missing fields.
  if (!content) return defaults;
  return {
    ...defaults,
    plot: {
      status: content.plot.status,
      file: content.plot.file || defaults.plot.file,
      items: content.plot.items,
      item_files: content.plot.itemFiles,
    },
    story: {
      status: content.story.status,
      file: content.story.file || defaults.story.file,
      items: content.story.items,
      item_files: content.story.itemFiles,
    },
    characters: {
      status: content.characters.status,
      file: content.characters.file || defaults.characters.file,
      items: content.characters.items,
      item_files: content.characters.itemFiles,
    },
    settings: {
      status: content.settings.status,
      file: content.settings.file || defaults.settings.file,
      items: content.settings.items,
      item_files: content.settings.itemFiles,
    },
    scenes: {
      status: content.scenes.status,
      file: content.scenes.file || defaults.scenes.file,
      items: content.scenes.items,
      item_files: content.scenes.itemFiles,
    },
    images: {
      status: content.images.status,
      file: content.images.file || '',
      items: content.images.items,
      item_files: content.images.itemFiles,
    },
    videos: {
      status: content.videos.status,
      file: content.videos.file || '',
      items: content.videos.items,
      item_files: content.videos.itemFiles,
    },
    audio: defaults.audio,
    captions: defaults.captions,
  };
}

function toBackendContent(
  content: AgentProjectFile['content'],
): BackendProjectFile['content'] {
  return {
    plot: {
      status: content.plot.status,
      file: content.plot.file,
      items: content.plot.items,
      itemFiles: content.plot.item_files,
    },
    story: {
      status: content.story.status,
      file: content.story.file,
      items: content.story.items,
      itemFiles: content.story.item_files,
    },
    characters: {
      status: content.characters.status,
      file: content.characters.file,
      items: content.characters.items,
      itemFiles: content.characters.item_files,
    },
    settings: {
      status: content.settings.status,
      file: content.settings.file,
      items: content.settings.items,
      itemFiles: content.settings.item_files,
    },
    scenes: {
      status: content.scenes.status,
      file: content.scenes.file,
      items: content.scenes.items,
      itemFiles: content.scenes.item_files,
    },
    images: {
      status: content.images.status,
      file: content.images.file || undefined,
      items: content.images.items,
      itemFiles: content.images.item_files,
    },
    videos: {
      status: content.videos.status,
      file: content.videos.file || undefined,
      items: content.videos.items,
      itemFiles: content.videos.item_files,
    },
  };
}

function mapCharacterToDesktop(character: BackendCharacterData): CharacterData {
  return {
    name: character.name,
    slug: slugify(character.name),
    description: character.description,
    visual_description: character.visualDescription,
    approval_status: character.approvalStatus,
    reference_image_approval_status: character.referenceImageApprovalStatus,
    content_artifact_id: character.contentArtifactId,
    reference_image_id: character.referenceImageId,
    reference_image_path: character.referenceImagePath,
    approved_at: character.approvedAt,
    reference_image_approved_at: character.referenceImageApprovedAt,
    regeneration_count: character.regenerationCount,
  };
}

function mapSettingToDesktop(setting: BackendSettingData): SettingData {
  return {
    name: setting.name,
    slug: slugify(setting.name),
    description: setting.description,
    visual_description: setting.visualDescription,
    approval_status: setting.approvalStatus,
    reference_image_approval_status: setting.referenceImageApprovalStatus,
    content_artifact_id: setting.contentArtifactId,
    reference_image_id: setting.referenceImageId,
    reference_image_path: setting.referenceImagePath,
    approved_at: setting.approvedAt,
    reference_image_approved_at: setting.referenceImageApprovedAt,
    regeneration_count: setting.regenerationCount,
  };
}

function sceneFolder(scene: BackendSceneRef): string {
  if (scene.file?.trim()) {
    const fileName = scene.file.replace(/\\/g, '/').split('/').pop();
    if (fileName) {
      return fileName.replace(/\.[^.]+$/, '');
    }
  }
  return `scene-${String(scene.sceneNumber).padStart(3, '0')}`;
}

function latestAssetPathForScene(
  assets: AssetManifest | null | undefined,
  sceneNumber: number,
  type: 'scene_image' | 'scene_video',
): string | undefined {
  const matches =
    assets?.assets.filter(
      (asset) =>
        asset.type === type &&
        asset.scene_number === sceneNumber &&
        asset.metadata?.['shot_number'] === undefined,
    ) ?? [];

  if (matches.length === 0) return undefined;

  return matches.reduce((latest, current) =>
    current.version > latest.version ? current : latest,
  ).path;
}

function mapSceneToDesktop(
  scene: BackendSceneRef,
  assets?: AssetManifest | null,
): SceneRef {
  return {
    scene_number: scene.sceneNumber,
    folder: sceneFolder(scene),
    title: scene.title,
    description: scene.description,
    content_approval_status: scene.contentApprovalStatus,
    content_artifact_id: scene.contentArtifactId,
    content_approved_at: scene.contentApprovedAt,
    image_approval_status: scene.imageApprovalStatus,
    image_artifact_id: scene.imageArtifactId,
    image_path:
      latestAssetPathForScene(assets, scene.sceneNumber, 'scene_image') ??
      undefined,
    image_prompt: scene.imagePrompt,
    image_approved_at: scene.imageApprovedAt,
    video_approval_status: scene.videoApprovalStatus,
    video_artifact_id: scene.videoArtifactId,
    video_path:
      latestAssetPathForScene(assets, scene.sceneNumber, 'scene_video') ??
      undefined,
    video_approved_at: scene.videoApprovedAt,
    regeneration_count: scene.regenerationCount,
    feedback: scene.feedback,
  };
}

function mapPhaseRecordToDesktop(
  phases: Record<string, BackendPhaseInfo> | undefined | null,
): AgentProjectFile['phases'] {
  const defaults = createDefaultWorkflowPhases();
  const next = {
    ...defaults,
  } as unknown as Record<
    string,
    AgentProjectFile['phases'][keyof AgentProjectFile['phases']]
  >;

  // v3.0 projects (kshana-ink dependency-graph executor) drop the
  // `phases` map entirely — workflow state lives in executorState
  // now. Fall back to the defaults map without throwing.
  Object.entries(phases ?? {}).forEach(([phase, info]) => {
    next[phase] = {
      status: info.status,
      planner_stage: info.plannerStage,
      plan_file: info.planFile,
      completed_at: info.completedAt,
      refinement_count: info.refinementCount,
    };
  });

  return next as unknown as AgentProjectFile['phases'];
}

function mapPhaseRecordToBackend(
  phases: AgentProjectFile['phases'],
): Record<string, BackendPhaseInfo> {
  return Object.fromEntries(
    Object.entries(phases).map(([phase, info]) => [
      phase,
      {
        status: info.status,
        plannerStage: info.planner_stage,
        planFile: info.plan_file,
        completedAt: info.completed_at,
        refinementCount: info.refinement_count,
      },
    ]),
  );
}

export function createDefaultBackendProject(params: {
  id: string;
  title: string;
  description?: string;
  style?: string;
  templateId?: string;
  targetDuration?: number;
}): BackendProjectFile {
  const now = Date.now();
  return {
    version: '2.0',
    id: params.id,
    title: params.title,
    description: params.description?.trim() || undefined,
    originalInputFile: 'original_input.md',
    style: params.style ?? '',
    inputType: 'idea',
    createdAt: now,
    updatedAt: now,
    currentPhase: 'plot',
    templateId: params.templateId,
    phases: {
      plot: { status: 'pending', completedAt: null },
      story: { status: 'pending', completedAt: null },
      characters_settings: { status: 'pending', completedAt: null },
      scenes: { status: 'pending', completedAt: null },
      character_setting_images: { status: 'pending', completedAt: null },
      scene_images: { status: 'pending', completedAt: null },
      video: { status: 'pending', completedAt: null },
      video_combine: { status: 'pending', completedAt: null },
    },
    content: {
      plot: { status: 'missing' },
      story: { status: 'missing' },
      characters: { status: 'missing', items: [] },
      settings: { status: 'missing', items: [] },
      scenes: { status: 'missing', items: [] },
      images: { status: 'missing', items: [] },
      videos: { status: 'missing', items: [] },
    },
    characters: [],
    settings: [],
    scenes: [],
    assets: [],
    ...(typeof params.targetDuration === 'number'
      ? { targetDuration: params.targetDuration, duration: params.targetDuration }
      : {}),
    productionStartedAt: now,
  };
}

export function backendProjectToDesktopManifest(
  project: BackendProjectFile,
): KshanaManifest {
  const manifest = createDefaultManifest(project.id, project.title, '1.0.0');
  manifest.description = project.description?.trim() || undefined;
  manifest.created_at = new Date(project.createdAt).toISOString();
  manifest.updated_at = new Date(project.updatedAt).toISOString();
  return manifest;
}

export function backendProjectToDesktopAgentState(
  project: BackendProjectFile,
  assets?: AssetManifest | null,
): AgentProjectFile {
  // kshana-ink v3.0 dropped the legacy parallel-state fields
  // (phases, content, characters[], settings[], scenes[], assets[]) —
  // see `unify-project-state.md`. The asset manifest + executor
  // graph carry that information now. This adapter must default
  // each field to an empty value rather than crashing on undefined.
  return {
    version: '2.0',
    id: project.id,
    title: project.title,
    original_input_file: project.originalInputFile,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    current_phase: project.currentPhase as AgentProjectFile['current_phase'],
    phases: mapPhaseRecordToDesktop(project.phases),
    content: toDesktopContent(project.content),
    characters: (project.characters ?? []).map(mapCharacterToDesktop),
    settings: (project.settings ?? []).map(mapSettingToDesktop),
    scenes: (project.scenes ?? []).map((scene) => mapSceneToDesktop(scene, assets)),
    assets: [...(project.assets ?? [])],
    final_video: project.finalVideo
      ? {
          artifact_id: project.finalVideo.artifactId,
          path: project.finalVideo.path,
          duration: project.finalVideo.duration,
          created_at: project.finalVideo.createdAt,
        }
      : undefined,
  };
}

export function desktopAgentStateToBackendProject(
  agentState: AgentProjectFile,
  existing: BackendProjectFile,
): BackendProjectFile {
  return {
    ...existing,
    id: agentState.id,
    title: agentState.title,
    originalInputFile: agentState.original_input_file,
    createdAt: agentState.created_at,
    updatedAt: Date.now(),
    currentPhase: agentState.current_phase,
    phases: mapPhaseRecordToBackend(agentState.phases),
    content: toBackendContent(agentState.content),
    characters: agentState.characters.map((character) => ({
      name: character.name,
      description: character.description,
      visualDescription: character.visual_description,
      approvalStatus: character.approval_status,
      referenceImageApprovalStatus: character.reference_image_approval_status,
      contentArtifactId: character.content_artifact_id,
      referenceImageId: character.reference_image_id,
      referenceImagePath: character.reference_image_path,
      approvedAt: character.approved_at,
      referenceImageApprovedAt: character.reference_image_approved_at,
      regenerationCount: character.regeneration_count,
    })),
    settings: agentState.settings.map((setting) => ({
      name: setting.name,
      description: setting.description,
      visualDescription: setting.visual_description,
      approvalStatus: setting.approval_status,
      referenceImageApprovalStatus: setting.reference_image_approval_status,
      contentArtifactId: setting.content_artifact_id,
      referenceImageId: setting.reference_image_id,
      referenceImagePath: setting.reference_image_path,
      approvedAt: setting.approved_at,
      referenceImageApprovedAt: setting.reference_image_approved_at,
      regenerationCount: setting.regeneration_count,
    })),
    scenes: agentState.scenes.map((scene) => ({
      sceneNumber: scene.scene_number,
      file: scene.folder ? `scenes/${scene.folder}.md` : undefined,
      title: scene.title,
      description: scene.description,
      contentApprovalStatus: scene.content_approval_status,
      contentArtifactId: scene.content_artifact_id,
      contentApprovedAt: scene.content_approved_at,
      imageApprovalStatus: scene.image_approval_status,
      imageArtifactId: scene.image_artifact_id,
      imagePrompt: scene.image_prompt,
      imageApprovedAt: scene.image_approved_at,
      videoApprovalStatus: scene.video_approval_status,
      videoArtifactId: scene.video_artifact_id,
      videoApprovedAt: scene.video_approved_at,
      regenerationCount: scene.regeneration_count,
      feedback: scene.feedback,
    })),
    assets: [...agentState.assets],
    finalVideo: agentState.final_video
      ? {
          artifactId: agentState.final_video.artifact_id,
          path: agentState.final_video.path,
          duration: agentState.final_video.duration,
          createdAt: agentState.final_video.created_at,
        }
      : existing.finalVideo,
  };
}

export function backendAssetManifestToDesktop(
  manifest: BackendAssetManifest,
): AssetManifest {
  return {
    schema_version: (manifest.schema_version as '1') || '1',
    assets: (manifest.assets || []).map((asset) => ({
      id: asset.id,
      type: asset.type as AssetManifest['assets'][number]['type'],
      path: asset.path,
      entity_slug: asset.entity_slug,
      scene_number: asset.scene_number,
      version: asset.version ?? 1,
      created_at: asset.created_at ?? asset.createdAt ?? Date.now(),
      metadata: asset.metadata,
    })),
  };
}

export function desktopAssetManifestToBackend(
  manifest: AssetManifest,
): BackendAssetManifest {
  return {
    assets: manifest.assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      path: asset.path,
      entity_slug: asset.entity_slug,
      scene_number: asset.scene_number,
      version: asset.version,
      createdAt: asset.created_at,
      metadata: asset.metadata,
    })),
  };
}
