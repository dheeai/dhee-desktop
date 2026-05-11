/**
 * Shared types for Remotion integration between main and renderer processes.
 */

export interface RemotionPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  infographicType:
    | 'statistic'
    | 'list'
    | 'bar_chart'
    | 'line_chart'
    | 'diagram';
  prompt: string;
  data?: Record<string, unknown>;
  componentName: string;
}

export interface RemotionRenderInput {
  placements: RemotionPlacement[];
}

export interface RemotionJob {
  id: string;
  projectDirectory: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  outputFiles: string[];
  error?: string;
  tempDir?: string;
}

export interface RemotionProgress {
  jobId: string;
  placementIndex: number;
  totalPlacements: number;
  progress: number;
  stage: 'rendering' | 'encoding' | 'finalizing';
}

export interface RemotionTimelineItem {
  id: string;
  type: 'infographic';
  startTime: number;
  endTime: number;
  duration: number;
  label: string;
  prompt?: string;
  placementNumber?: number;
  videoPath?: string;
}

export interface ParsedInfographicPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  infographicType:
    | 'bar_chart'
    | 'line_chart'
    | 'diagram'
    | 'statistic'
    | 'list';
  prompt: string;
  data?: Record<string, unknown>;
}

export interface RemotionGeneratedComponent {
  placementNumber: number;
  componentName: string;
  componentCode: string;
}

export interface RemotionComponentSource {
  mode: 'user_space' | 'legacy_runtime';
  /** Path relative to project `.dhee/` root. */
  componentsDir: string;
  /** Path relative to project `.dhee/` root. */
  indexPath: string;
}

export interface RemotionServerRenderRequest {
  requestId: string;
  projectDir?: string;
  placements: RemotionPlacement[];
  components: RemotionGeneratedComponent[];
  indexContent: string;
  componentSource?: RemotionComponentSource;
}

export interface RemotionFailureDetails {
  code:
    | 'esbuild_spawn_enotdir'
    | 'asar_runtime_module_resolution_failed'
    | 'infographic_component_missing'
    | 'desktop_remotion_user_space_render_failed'
    | 'remotion_render_failed';
  stage: 'bundling' | 'rendering' | 'finalizing' | 'unknown';
  packaged: boolean;
  remotionDir: string;
  esbuildBinaryPath?: string;
  hint?: string;
  resolvedModulePaths?: {
    bundler: string;
    renderer: string;
    react: string;
    esbuild: string;
  };
}

export interface RemotionServerRenderResult {
  requestId: string;
  status: 'completed' | 'failed';
  outputs?: string[];
  error?: string;
  details?: RemotionFailureDetails | Record<string, unknown>;
}

export interface RemotionServerRenderProgress {
  requestId: string;
  progress: number;
  stage?: 'bundling' | 'rendering' | 'finalizing';
  placementIndex?: number;
  totalPlacements?: number;
  message?: string;
}
