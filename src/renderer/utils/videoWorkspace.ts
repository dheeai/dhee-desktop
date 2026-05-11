/**
 * Video Workspace Utility
 * Manages video folder structure in dhee projects
 * Handles video versioning, current.txt tracking, and metadata
 */

import { stripFileProtocol } from './pathNormalizer';

/**
 * Video metadata stored in vN_info.json files
 */
export interface VideoMetadata {
  /** Prompt used to generate the video */
  prompt?: string;

  /** Seed used for generation (if applicable) */
  seed?: number;

  /** Duration in seconds */
  duration?: number;

  /** Artifact ID */
  artifact_id?: string;

  /** Created timestamp (ISO8601) */
  created_at?: string;

  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Copy video to scene folder and create version structure
 * @param videoPath - Source video file path (absolute or relative)
 * @param projectDirectory - Project root directory
 * @param sceneFolder - Scene folder name (e.g., "scene-001")
 * @param version - Version number (1, 2, 3, etc.)
 * @param metadata - Optional video metadata
 * @returns Promise resolving to relative path of copied video
 */
export async function copyVideoToScene(
  videoPath: string,
  projectDirectory: string,
  sceneFolder: string,
  version: number,
  metadata?: VideoMetadata,
): Promise<string> {
  // Construct target directory: .dhee/agent/scenes/scene-XXX/video/
  const videoDir = `${projectDirectory}/.dhee/agent/scenes/${sceneFolder}/video`;

  // Ensure video directory exists
  // Ensure video directory exists
  // We use the relative path from project directory to avoid absolute path splitting issues
  const relativeVideoDir = `.dhee/agent/scenes/${sceneFolder}/video`;
  await window.electron.project.createFolder(
    projectDirectory,
    relativeVideoDir,
  );

  // Construct target filename: vN.mp4
  const targetFileName = `v${version}.mp4`;
  const targetPath = `${videoDir}/${targetFileName}`;
  const relativePath = `.dhee/agent/scenes/${sceneFolder}/video/${targetFileName}`;

  // Read video as base64 and write as binary (similar to images)
  try {
    // Remove file:// protocol if present
    const cleanPath = stripFileProtocol(videoPath);

    // Read video file as base64
    const base64DataUri =
      await window.electron.project.readFileBase64(cleanPath);
    if (!base64DataUri) {
      throw new Error(`Failed to read video file: ${cleanPath}`);
    }

    // Extract base64 data from data URI
    const base64Match = base64DataUri.match(/^data:video\/[^;]+;base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Invalid base64 data URI format');
    }

    const base64Data = base64Match[1];

    // Write binary file from base64 data
    await window.electron.project.writeFileBinary(targetPath, base64Data);
  } catch (error) {
    console.warn(
      `Failed to convert and write video using base64, falling back to copy:`,
      error,
    );
    // Fallback to direct copy if base64 conversion fails
    await window.electron.project.copy(videoPath, videoDir);
    // Rename if needed
    const copiedFileName = videoPath.replace(/\\/g, '/').split('/').pop();
    if (copiedFileName && copiedFileName !== targetFileName) {
      const copiedFilePath = `${videoDir}/${copiedFileName}`;
      await window.electron.project.rename(copiedFilePath, targetFileName);
    }
  }

  // Create metadata file: vN_info.json
  if (metadata) {
    const metadataPath = `${videoDir}/v${version}_info.json`;
    await window.electron.project.writeFile(
      metadataPath,
      JSON.stringify(
        {
          version,
          prompt: metadata.prompt,
          seed: metadata.seed,
          duration: metadata.duration,
          artifact_id: metadata.artifact_id,
          created_at: metadata.created_at || new Date().toISOString(),
          ...metadata,
        },
        null,
        2,
      ),
    );
  }

  return relativePath;
}

/**
 * Update current.txt to point to active video version
 * @param projectDirectory - Project root directory
 * @param sceneFolder - Scene folder name (e.g., "scene-001")
 * @param version - Version number to set as active
 */
export async function setActiveVideoVersion(
  projectDirectory: string,
  sceneFolder: string,
  version: number,
): Promise<void> {
  const videoDir = `${projectDirectory}/.dhee/agent/scenes/${sceneFolder}/video`;
  const currentTxtPath = `${videoDir}/current.txt`;
  const fileName = `v${version}.mp4`;

  // Ensure video directory exists
  // Ensure video directory exists
  // We use the relative path from project directory to avoid absolute path splitting issues
  const relativeVideoDir = `.dhee/agent/scenes/${sceneFolder}/video`;
  await window.electron.project.createFolder(
    projectDirectory,
    relativeVideoDir,
  );

  // Write current.txt with version filename
  await window.electron.project.writeFile(currentTxtPath, fileName);
}

/**
 * Get active video path for a scene
 * @param projectDirectory - Project root directory
 * @param sceneFolder - Scene folder name (e.g., "scene-001")
 * @returns Promise resolving to relative path of active video, or null if none
 */
export async function getActiveVideoPath(
  projectDirectory: string,
  sceneFolder: string,
): Promise<string | null> {
  const videoDir = `${projectDirectory}/.dhee/agent/scenes/${sceneFolder}/video`;
  const currentTxtPath = `${videoDir}/current.txt`;

  try {
    // Try to read current.txt
    const currentContent =
      await window.electron.project.readFile(currentTxtPath);
    if (currentContent) {
      const fileName = currentContent.trim();
      return `.dhee/agent/scenes/${sceneFolder}/video/${fileName}`;
    }
  } catch {
    // current.txt doesn't exist or can't be read
  }

  // Fallback: check if v1.mp4 exists
  try {
    const v1Path = `${videoDir}/v1.mp4`;
    await window.electron.project.readFile(v1Path); // Just check if exists
    return `.dhee/agent/scenes/${sceneFolder}/video/v1.mp4`;
  } catch {
    // No video found
    return null;
  }
}

/**
 * Get video metadata for a specific version
 * @param projectDirectory - Project root directory
 * @param sceneFolder - Scene folder name (e.g., "scene-001")
 * @param version - Version number
 * @returns Promise resolving to metadata object, or null if not found
 */
export async function getVideoMetadata(
  projectDirectory: string,
  sceneFolder: string,
  version: number,
): Promise<VideoMetadata | null> {
  const videoDir = `${projectDirectory}/.dhee/agent/scenes/${sceneFolder}/video`;
  const metadataPath = `${videoDir}/v${version}_info.json`;

  try {
    const content = await window.electron.project.readFile(metadataPath);
    if (content) {
      return JSON.parse(content) as VideoMetadata;
    }
  } catch {
    // Metadata file doesn't exist
  }

  return null;
}

/**
 * List all video versions for a scene
 * @param projectDirectory - Project root directory
 * @param sceneFolder - Scene folder name (e.g., "scene-001")
 * @returns Promise resolving to array of version numbers
 */
export async function listVideoVersions(
  projectDirectory: string,
  sceneFolder: string,
): Promise<number[]> {
  const videoDir = `${projectDirectory}/.dhee/agent/scenes/${sceneFolder}/video`;

  try {
    // Check versions sequentially - readFile returns null for missing files, doesn't throw
    const versions: number[] = [];
    for (let v = 1; v <= 100; v += 1) {
      const videoPath = `${videoDir}/v${v}.mp4`;
      const fileContent = await window.electron.project.readFile(videoPath);

      // readFile returns null if file doesn't exist
      if (fileContent === null) {
        // No more versions found, stop checking
        break;
      }

      // File exists, add version
      versions.push(v);
    }
    return versions;
  } catch {
    return [];
  }
}
