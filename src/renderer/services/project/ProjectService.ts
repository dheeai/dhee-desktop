/**
 * Project Service
 * Orchestrates project operations including loading, saving, and managing project state
 */

import type {
  dheeProject,
  dheeManifest,
  AgentProjectFile,
  AssetManifest,
  dheeTimelineState,
  ContextIndex,
  WorkflowPhase,
  ItemApprovalStatus,
  AssetInfo,
} from '../../types/dhee';
import {
  PROJECT_PATHS,
  DEFAULT_TIMELINE_STATE,
  createDefaultContextIndex,
} from '../../types/dhee';
import { safeJsonParse } from '../../utils/safeJsonParse';
import {
  backendAssetManifestToDesktop,
  backendProjectToDesktopAgentState,
  backendProjectToDesktopManifest,
  createDefaultBackendProject,
  desktopAgentStateToBackendProject,
  desktopAssetManifestToBackend,
  normalizeBackendProjectForWrite,
  type BackendAssetManifest,
  type BackendProjectFile,
} from './backendProjectAdapter';

/**
 * Result type for async operations
 */
export type ProjectResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Project validation result
 */
export interface ProjectValidation {
  isValid: boolean;
  hasManifest: boolean;
  hasAgentState: boolean;
  hasAssetManifest: boolean;
  hasTimelineState: boolean;
  errors: string[];
}

type JSONReadStatus = 'ok' | 'missing' | 'invalid';

interface JSONReadResult<T> {
  status: JSONReadStatus;
  data?: T;
  error?: string;
}

interface AssetManifestReadResult {
  status: JSONReadStatus;
  manifest?: AssetManifest;
  error?: string;
}

interface ProjectFileOpMeta {
  source: 'renderer';
  projectRoot: string;
}

/**
 * Project Service class
 * Handles all project-related operations
 */
export class ProjectService {
  private projectDirectory: string | null = null;

  private currentProject: dheeProject | null = null;

  private currentBackendProject: BackendProjectFile | null = null;

  private lastOpenTimestamp = 0;

  private lastOpenDirectory: string | null = null;

  private lastOpenResult: ProjectResult<dheeProject> | null = null;

  private pendingOpen: Promise<ProjectResult<dheeProject>> | null = null;

  private static readonly MIN_OPEN_INTERVAL_MS = 2000;

  /**
   * Invalidate the cached openProject result so the next call reads from disk.
   * Useful when external processes have just modified project files (e.g., manifest).
   */
  invalidateCache(): void {
    this.lastOpenResult = null;
    this.lastOpenTimestamp = 0;
    this.pendingOpen = null;
  }

  /**
   * Lightweight manifest-only read that bypasses the openProject cache.
   */
  async readAssetManifest(directory: string): Promise<AssetManifest | null> {
    const result = await this.readAssetManifestWithStatus(directory);
    if (result.status === 'ok' && result.manifest) {
      return result.manifest;
    }
    return null;
  }

  /**
   * Gets the current project directory
   */
  getProjectDirectory(): string | null {
    return this.projectDirectory;
  }

  /**
   * Gets the current project
   */
  getCurrentProject(): dheeProject | null {
    return this.currentProject;
  }

  /**
   * Validates if a directory is a valid dhee project
   * CLI projects use .dhee/agent/project.json as the primary source
   * Desktop projects may also have dhee.json at root (optional)
   */
  async validateProject(directory: string): Promise<ProjectValidation> {
    const errors: string[] = [];

    // Check for backend project state (required)
    const agentStatePath = ProjectService.buildPath(
      directory,
      PROJECT_PATHS.AGENT_PROJECT,
    );
    const hasAgentState = await this.fileExists(agentStatePath);
    if (!hasAgentState) {
      errors.push('Missing project.json file');
    }

    // Check for asset manifest
    const assetManifestPath = ProjectService.buildPath(
      directory,
      PROJECT_PATHS.AGENT_MANIFEST,
    );
    const hasAssetManifest = await this.fileExists(assetManifestPath);

    // Check for timeline state
    const timelinePath = ProjectService.buildPath(
      directory,
      PROJECT_PATHS.UI_TIMELINE,
    );
    const hasTimelineState = await this.fileExists(timelinePath);

    // Project is valid if it has agent state (CLI structure)
    return {
      isValid: hasAgentState,
      hasManifest: hasAgentState,
      hasAgentState,
      hasAssetManifest,
      hasTimelineState,
      errors,
    };
  }

  /**
   * Opens a project from the given directory.
   * Rate-limited: subsequent calls for the same directory within MIN_OPEN_INTERVAL_MS
   * return the cached result to avoid redundant disk reads from multiple trigger sources.
   */
  async openProject(directory: string): Promise<ProjectResult<dheeProject>> {
    const now = Date.now();
    const sameDir = directory === this.lastOpenDirectory;

    if (
      sameDir &&
      this.lastOpenResult &&
      now - this.lastOpenTimestamp < ProjectService.MIN_OPEN_INTERVAL_MS
    ) {
      return this.lastOpenResult;
    }

    // Deduplicate concurrent calls: if one is already in flight, piggyback on it
    if (sameDir && this.pendingOpen) {
      return this.pendingOpen;
    }

    const doOpen = async (): Promise<ProjectResult<dheeProject>> => {
      try {
        const validation = await this.validateProject(directory);
        if (!validation.isValid) {
          return {
            success: false,
            error: validation.errors.join('; '),
          };
        }

        const agentState = await this.readAgentState(directory);
        if (!agentState) {
          return { success: false, error: 'Failed to read project.json file' };
        }

        const sameLoadedProject = this.projectDirectory === directory;
        const inMemoryAssetManifest = sameLoadedProject
          ? (this.currentProject?.assetManifest ?? null)
          : null;

        const assetManifestResult =
          await this.readAssetManifestWithStatus(directory);
        let assetManifest: AssetManifest;

        if (
          assetManifestResult.status === 'ok' &&
          assetManifestResult.manifest
        ) {
          assetManifest = assetManifestResult.manifest;
          console.log('[ProjectService] Asset manifest loaded:', {
            source: 'disk',
            assetCount: assetManifest.assets.length,
            imageAssets: assetManifest.assets.filter(
              (a) => a.type === 'scene_image',
            ).length,
          });
        } else if (assetManifestResult.status === 'missing') {
          console.log(
            '[ProjectService] Asset manifest missing, creating default',
            {
              source: 'open_project',
              path: ProjectService.buildPath(
                directory,
                PROJECT_PATHS.AGENT_MANIFEST,
              ),
            },
          );
          assetManifest = backendAssetManifestToDesktop({ assets: [] });
          await this.writeAssetManifest(directory, assetManifest);
        } else {
          console.warn(
            '[ProjectService] Asset manifest invalid; preserving in-memory state when available',
            {
              source: 'open_project',
              path: ProjectService.buildPath(
                directory,
                PROJECT_PATHS.AGENT_MANIFEST,
              ),
              hasInMemoryManifest: !!inMemoryAssetManifest,
              error: assetManifestResult.error,
            },
          );
          assetManifest =
            inMemoryAssetManifest ??
            backendAssetManifestToDesktop({ assets: [] });
        }

        const manifest = backendProjectToDesktopManifest(agentState);
        const desktopAgentState = backendProjectToDesktopAgentState(
          agentState,
          assetManifest,
        );

        let timelineState = await this.readTimelineState(directory);
        if (!timelineState) {
          timelineState = { ...DEFAULT_TIMELINE_STATE };
        }

        let contextIndex = await this.readContextIndex(directory);
        if (!contextIndex) {
          contextIndex = createDefaultContextIndex();
        }

        this.projectDirectory = directory;
        this.currentBackendProject = agentState;
        this.currentProject = {
          manifest,
          agentState: desktopAgentState,
          assetManifest,
          timelineState,
          contextIndex,
        };

        return { success: true, data: this.currentProject };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    };

    this.pendingOpen = doOpen();
    try {
      const result = await this.pendingOpen;
      this.lastOpenTimestamp = Date.now();
      this.lastOpenDirectory = directory;
      this.lastOpenResult = result;
      return result;
    } finally {
      this.pendingOpen = null;
    }
  }

  /**
   * Creates a new project in the given directory
   */
  async createProject(
    directory: string,
    name: string,
    description?: string,
  ): Promise<ProjectResult<dheeProject>> {
    try {
      // Create directory structure
      await this.createProjectStructure(directory);

      // Create agent state first (primary source)
      const projectId = `proj_${Date.now()}`;
      const backendProject = createDefaultBackendProject({
        id: projectId,
        title: name,
        description,
      });
      const agentState = backendProjectToDesktopAgentState(backendProject);
      await this.writeAgentState(directory, agentState);

      const manifest = backendProjectToDesktopManifest(backendProject);

      // Create asset manifest
      const assetManifest = backendAssetManifestToDesktop({ assets: [] });
      await this.writeAssetManifest(directory, assetManifest);
      const timelineState = { ...DEFAULT_TIMELINE_STATE };
      await this.writeTimelineState(directory, timelineState);
      const contextIndex = createDefaultContextIndex();
      await this.writeContextIndex(directory, contextIndex);

      this.projectDirectory = directory;
      this.currentBackendProject = backendProject;
      this.currentProject = {
        manifest,
        agentState,
        assetManifest,
        timelineState,
        contextIndex,
      };

      return { success: true, data: this.currentProject };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Closes the current project
   */
  closeProject(): void {
    this.projectDirectory = null;
    this.currentProject = null;
    this.currentBackendProject = null;
  }

  /**
   * Updates the workflow phase
   */
  async updatePhase(phase: WorkflowPhase): Promise<ProjectResult<void>> {
    if (!this.currentProject || !this.projectDirectory) {
      return { success: false, error: 'No project open' };
    }

    this.currentProject.agentState.current_phase = phase;
    this.currentProject.agentState.updated_at = Date.now();

    await this.writeAgentState(
      this.projectDirectory,
      this.currentProject.agentState,
    );

    return { success: true, data: undefined };
  }

  /**
   * Updates scene approval status
   */
  async updateSceneApproval(
    sceneNumber: number,
    field: 'content' | 'image' | 'video' | 'audio',
    status: ItemApprovalStatus,
  ): Promise<ProjectResult<void>> {
    if (!this.currentProject || !this.projectDirectory) {
      return { success: false, error: 'No project open' };
    }

    const scene = this.currentProject.agentState.scenes.find(
      (s) => s.scene_number === sceneNumber,
    );
    if (!scene) {
      return { success: false, error: `Scene ${sceneNumber} not found` };
    }

    const statusKey = `${field}_approval_status` as keyof typeof scene;
    (scene as unknown as Record<string, unknown>)[statusKey] = status;

    if (status === 'approved') {
      const approvedKey = `${field}_approved_at` as keyof typeof scene;
      (scene as unknown as Record<string, unknown>)[approvedKey] = Date.now();
    }

    this.currentProject.agentState.updated_at = Date.now();

    await this.writeAgentState(
      this.projectDirectory,
      this.currentProject.agentState,
    );

    return { success: true, data: undefined };
  }

  /**
   * Saves timeline state
   */
  async saveTimelineState(
    state: dheeTimelineState,
  ): Promise<ProjectResult<void>> {
    if (!this.currentProject || !this.projectDirectory) {
      return { success: false, error: 'No project open' };
    }

    this.currentProject.timelineState = state;

    await this.writeTimelineState(this.projectDirectory, state);

    return { success: true, data: undefined };
  }

  /**
   * Adds an asset to the asset manifest
   */
  async addAssetToManifest(
    assetInfo: AssetInfo,
  ): Promise<ProjectResult<AssetInfo>> {
    if (!this.currentProject || !this.projectDirectory) {
      return { success: false, error: 'No project open' };
    }

    // Check if asset with same ID already exists
    const existingIndex = this.currentProject.assetManifest.assets.findIndex(
      (asset) => asset.id === assetInfo.id,
    );

    if (existingIndex >= 0) {
      // Update existing asset
      this.currentProject.assetManifest.assets[existingIndex] = assetInfo;
    } else {
      // Add new asset
      this.currentProject.assetManifest.assets.push(assetInfo);
    }

    await this.writeAssetManifest(
      this.projectDirectory,
      this.currentProject.assetManifest,
    );

    return { success: true, data: assetInfo };
  }

  /**
   * Updates the asset manifest
   */
  async updateAssetManifest(
    manifest: AssetManifest,
  ): Promise<ProjectResult<void>> {
    if (!this.currentProject || !this.projectDirectory) {
      return { success: false, error: 'No project open' };
    }

    this.currentProject.assetManifest = manifest;

    await this.writeAssetManifest(this.projectDirectory, manifest);

    return { success: true, data: undefined };
  }

  // === Private helper methods ===

  private static buildPath(directory: string, ...segments: string[]): string {
    const normalized = directory.replace(/\\/g, '/').replace(/\/+$/, '');
    return [normalized, ...segments].join('/');
  }

  private static fileOpMeta(directory: string): ProjectFileOpMeta {
    return {
      source: 'renderer',
      projectRoot: directory.replace(/\\/g, '/').replace(/\/+$/, ''),
    };
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      const content = await window.electron.project.readFile(path);
      return content !== null;
    } catch {
      return false;
    }
  }

  private async readJSONWithStatus<T>(
    path: string,
  ): Promise<JSONReadResult<T>> {
    try {
      const content = await window.electron.project.readFile(path);
      if (content === null) {
        return { status: 'missing' };
      }
      try {
        return { status: 'ok', data: safeJsonParse<T>(content) };
      } catch (parseError) {
        // Primary file is corrupt -- try the atomic-write temp file as fallback
        try {
          const tmpContent = await window.electron.project.readFile(
            `${path}.tmp`,
          );
          if (tmpContent) {
            const tmpData = safeJsonParse<T>(tmpContent);
            console.warn(
              `[ProjectService] Recovered from corrupt JSON via .tmp fallback: ${path}`,
            );
            return { status: 'ok', data: tmpData };
          }
        } catch {
          // .tmp file also missing or corrupt -- fall through
        }

        return {
          status: 'invalid',
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        };
      }
    } catch (error) {
      console.error(
        `[ProjectService] Failed to read JSON from ${path}:`,
        error,
      );
      return {
        status: 'invalid',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async readJSON<T>(path: string): Promise<T | null> {
    const result = await this.readJSONWithStatus<T>(path);
    if (result.status === 'ok') {
      return result.data ?? null;
    }
    if (result.status === 'invalid') {
      console.error(
        `[ProjectService] Invalid JSON content in ${path}:`,
        result.error ?? 'Unknown parse error',
      );
    }
    return null;
  }

  private async writeJSON(
    path: string,
    data: unknown,
    projectRoot?: string,
  ): Promise<void> {
    try {
      const content = JSON.stringify(data, null, 2);
      await window.electron.project.writeFile(
        path,
        content,
        projectRoot ? ProjectService.fileOpMeta(projectRoot) : undefined,
      );
    } catch (error) {
      console.error(`[ProjectService] Failed to write JSON to ${path}:`, error);
      throw new Error(`Failed to write file: ${(error as Error).message}`);
    }
  }

  private async readManifest(
    directory: string,
  ): Promise<dheeManifest | null> {
    const project = await this.readBackendProject(directory);
    return project ? backendProjectToDesktopManifest(project) : null;
  }

  private async writeManifest(
    directory: string,
    manifest: dheeManifest,
  ): Promise<void> {
    if (!this.currentBackendProject) {
      return;
    }
    this.currentBackendProject.title = manifest.name;
    this.currentBackendProject.description =
      manifest.description?.trim() || undefined;
    this.currentBackendProject.updatedAt = Date.now();
    await this.writeJSON(
      ProjectService.buildPath(directory, PROJECT_PATHS.ROOT_MANIFEST),
      this.currentBackendProject,
      directory,
    );
  }

  private async readAgentState(
    directory: string,
  ): Promise<BackendProjectFile | null> {
    return this.readBackendProject(directory);
  }

  private async writeAgentState(
    directory: string,
    state: AgentProjectFile,
  ): Promise<void> {
    const latestBackendProject =
      (await this.readBackendProject(directory)) ??
      this.currentBackendProject ??
      createDefaultBackendProject({
        id: state.id,
        title: state.title,
      });

    const nextProject = desktopAgentStateToBackendProject(
      state,
      latestBackendProject,
    );
    const normalizedProject = normalizeBackendProjectForWrite(nextProject);
    this.currentBackendProject = normalizedProject;
    await this.writeJSON(
      ProjectService.buildPath(directory, PROJECT_PATHS.AGENT_PROJECT),
      normalizedProject,
      directory,
    );
  }

  private async readAssetManifestWithStatus(
    directory: string,
  ): Promise<AssetManifestReadResult> {
    const manifestPath = ProjectService.buildPath(
      directory,
      PROJECT_PATHS.AGENT_MANIFEST,
    );
    console.log('[ProjectService] Reading asset manifest from:', manifestPath);

    const manifestResult =
      await this.readJSONWithStatus<BackendAssetManifest>(manifestPath);

    if (manifestResult.status === 'missing') {
      console.warn(
        '[ProjectService] Asset manifest file missing:',
        manifestPath,
      );
      return { status: 'missing' };
    }

    if (manifestResult.status === 'invalid' || !manifestResult.data) {
      console.error('[ProjectService] Asset manifest is invalid JSON:', {
        path: manifestPath,
        error: manifestResult.error ?? 'Unknown parse error',
      });
      return { status: 'invalid', error: manifestResult.error };
    }

    const manifest = manifestResult.data;
    console.log('[ProjectService] Asset manifest read successfully:', {
      schemaVersion: manifest.schema_version,
      assetCount: manifest.assets?.length || 0,
    });

    return {
      status: 'ok',
      manifest: backendAssetManifestToDesktop(manifest),
    };
  }

  private async writeAssetManifest(
    directory: string,
    manifest: AssetManifest,
  ): Promise<void> {
    await this.writeJSON(
      ProjectService.buildPath(directory, PROJECT_PATHS.AGENT_MANIFEST),
      desktopAssetManifestToBackend(manifest),
      directory,
    );
  }

  private async readTimelineState(
    directory: string,
  ): Promise<dheeTimelineState | null> {
    const state = await this.readJSON<dheeTimelineState>(
      ProjectService.buildPath(directory, PROJECT_PATHS.UI_TIMELINE),
    );
    if (!state) return null;
    return this.normalizeTimelineState(state);
  }

  private async writeTimelineState(
    directory: string,
    state: dheeTimelineState,
  ): Promise<void> {
    await this.writeJSON(
      ProjectService.buildPath(directory, PROJECT_PATHS.UI_TIMELINE),
      state,
      directory,
    );
  }

  private normalizeTimelineState(
    state: dheeTimelineState,
  ): dheeTimelineState {
    return {
      ...DEFAULT_TIMELINE_STATE,
      ...state,
      active_versions: state.active_versions ?? {},
      markers: state.markers ?? [],
      imported_clips: state.imported_clips ?? [],
      image_timing_overrides: state.image_timing_overrides ?? {},
      infographic_timing_overrides: state.infographic_timing_overrides ?? {},
      video_split_overrides: state.video_split_overrides ?? {},
      segment_timing_overrides: state.segment_timing_overrides ?? {},
    };
  }

  private async readContextIndex(
    directory: string,
  ): Promise<ContextIndex | null> {
    return this.readJSON<ContextIndex>(
      ProjectService.buildPath(directory, PROJECT_PATHS.CONTEXT_INDEX),
    );
  }

  private async writeContextIndex(
    directory: string,
    contextIndex: ContextIndex,
  ): Promise<void> {
    await this.writeJSON(
      ProjectService.buildPath(directory, PROJECT_PATHS.CONTEXT_INDEX),
      contextIndex,
      directory,
    );
  }

  private async createProjectStructure(directory: string): Promise<void> {
    const dirs = [
      PROJECT_PATHS.VIDEOS_IMPORTED,
      PROJECT_PATHS.EXPORTS,
      PROJECT_PATHS.AGENT_PLANS,
      PROJECT_PATHS.AGENT_CHARACTERS,
      PROJECT_PATHS.AGENT_SETTINGS,
      PROJECT_PATHS.AGENT_SCENES,
      'assets',
      'assets/images',
      'assets/videos',
      'assets/infographics',
      'prompts',
      'prompts/images',
      'prompts/images/characters',
      'prompts/images/settings',
      'prompts/images/scenes',
      'prompts/videos',
      'prompts/videos/scenes',
      PROJECT_PATHS.AGENT_AUDIO,
    ];

    const normalizedDirectory = directory
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');
    for (const dir of dirs) {
      const parts = dir.split('/');
      let basePath = normalizedDirectory;
      for (const part of parts) {
        if (part) {
          const newPath = await window.electron.project.createFolder(
            basePath,
            part,
            ProjectService.fileOpMeta(normalizedDirectory),
          );
          if (newPath) {
            basePath = newPath.replace(/\\/g, '/');
          } else {
            basePath = `${basePath}/${part}`;
          }
        }
      }
    }
  }

  private async readBackendProject(
    directory: string,
  ): Promise<BackendProjectFile | null> {
    return this.readJSON<BackendProjectFile>(
      ProjectService.buildPath(directory, PROJECT_PATHS.AGENT_PROJECT),
    );
  }
}

/**
 * Singleton instance of ProjectService
 */
export const projectService = new ProjectService();

export default projectService;
