import type { AgentProjectFile, AssetManifest, AssetInfo } from '../../types/dhee';

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

export function buildProjectAbsolutePath(
  projectDirectory: string,
  relativePath: string,
): string {
  return `${normalizePath(projectDirectory)}/${normalizePath(relativePath)}`;
}

export function getManifestFinalVideoAsset(
  agentState: AgentProjectFile | null,
  assetManifest: AssetManifest | null,
): AssetInfo | null {
  if (!agentState?.final_video || !assetManifest?.assets?.length) {
    return null;
  }

  const expectedId = agentState.final_video.artifact_id;
  const expectedPath = normalizePath(agentState.final_video.path);

  return (
    assetManifest.assets.find(
      (asset) =>
        asset.type === 'final_video' &&
        (asset.id === expectedId || normalizePath(asset.path) === expectedPath),
    ) ?? null
  );
}

export function getFinalVideoStateWarning(
  agentState: AgentProjectFile | null,
  assetManifest: AssetManifest | null,
  projectDirectory: string | null,
  hasVerifiedLocalFile?: boolean,
): string | null {
  if (!agentState?.final_video) {
    return null;
  }

  if (!projectDirectory) {
    return 'Final video metadata exists, but no local project is active to verify it.';
  }

  const manifestAsset = getManifestFinalVideoAsset(agentState, assetManifest);
  if (!manifestAsset) {
    return 'Backend final video metadata is stale locally because no matching final_video asset exists in the manifest.';
  }

  const absolutePath = buildProjectAbsolutePath(projectDirectory, manifestAsset.path);
  const normalizedProjectDir = normalizePath(projectDirectory);
  if (!absolutePath.startsWith(`${normalizedProjectDir}/`)) {
    return 'Final video metadata points outside the active local project and will be ignored.';
  }

  if (hasVerifiedLocalFile === false) {
    return 'Backend final video metadata is stale locally because the registered final_video file is missing from the active project.';
  }

  return null;
}
