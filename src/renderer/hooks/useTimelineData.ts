/**
 * useTimelineData Hook
 * Reads the server-created root timeline.json and normalizes it for the desktop timeline.
 */

import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useTranscript } from './useTranscript';
import type { AssetInfo } from '../types/dhee/assetManifest';
import type { SceneVersions } from '../types/dhee/timeline';
import type { TextOverlayCue } from '../types/captions';
import { PROJECT_PATHS } from '../types/dhee';
import type { FileNode } from '../../shared/fileSystemTypes';
import {
  applySegmentTimingOverridesToItems,
  type SegmentTimingOverride,
} from '../utils/timelineImageEditing';
import { debugRendererDebug } from '../utils/debugLogger';

export interface TimelineItem {
  id: string;
  assetId?: string;
  type:
    | 'image'
    | 'video'
    | 'infographic'
    | 'placeholder'
    | 'audio'
    | 'text_overlay';
  startTime: number;
  endTime: number;
  duration: number;
  label: string;
  sceneLabel?: string;
  sceneNumber?: number;
  shotNumber?: number;
  prompt?: string;
  expandedPrompt?: string;
  placementNumber?: number;
  segmentId?: string;
  sourceType?: 'server_timeline';
  mediaTypeContext?: 'image' | 'video';
  mediaPathContext?: string;
  imagePath?: string;
  videoPath?: string;
  audioPath?: string;
  waveformPeaks?: number[];
  sourceStartTime?: number;
  sourceEndTime?: number;
  sourceOffsetSeconds?: number;
  sourcePlacementNumber?: number;
  sourcePlacementDurationSeconds?: number;
  segmentIndex?: number;
  textOverlayCue?: TextOverlayCue;
}

export interface TimelineData {
  timelineItems: TimelineItem[];
  overlayItems: TimelineItem[];
  textOverlayItems: TimelineItem[];
  textOverlayCues: TextOverlayCue[];
  totalDuration: number;
}

export interface TimelineDataWithRefresh extends TimelineData {
  refreshTimeline: () => Promise<void>;
  refreshAudioFiles: () => Promise<void>;
  timelineSource: 'server_timeline' | 'none';
  error: string | null;
  isTimelineLoading: boolean;
  isAudioLoading: boolean;
  validationIssues: TimelineValidationIssue[];
  normalizationSummary: {
    repairedCount: number;
    droppedCount: number;
  };
  isNormalizedFromCorruption: boolean;
}

export interface TimelineValidationIssue {
  segmentId: string;
  code:
    | 'recovered_from_manifest'
    | 'dropped_invalid_visual'
    | 'missing_visual'
    | 'video_preferred_over_image';
  message: string;
}

export interface TimelineAudioFile {
  assetId?: string;
  path: string;
  duration: number;
  waveformPeaks?: number[];
}

interface LatestRequestRef {
  current: number;
}

interface ServerTimelineLayer {
  type?: string;
  artifactId?: string;
  filePath?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

interface ServerTimelineSegment {
  id?: string;
  label?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  fillStatus?: string;
  layers?: ServerTimelineLayer[];
}

interface ServerTimelineDocument {
  version?: string;
  totalDuration?: number;
  segments?: ServerTimelineSegment[];
}

interface TimelineFileState {
  source: 'server_timeline' | 'none';
  timeline: ServerTimelineDocument | null;
  error: string | null;
}

interface TimelineIdentity {
  sceneNumber?: number;
  shotNumber?: number;
}

interface NormalizedServerTimelineData {
  items: TimelineItem[];
  validationIssues: TimelineValidationIssue[];
  normalizationSummary: {
    repairedCount: number;
    droppedCount: number;
  };
  isNormalizedFromCorruption: boolean;
}

function isSupportedAudioFileName(fileName: string): boolean {
  return /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(fileName);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getAudioLabelFromPath(audioPath: string): string {
  const fileName = audioPath.split(/[\\/]/).pop() ?? '';
  const label = fileName.replace(/\.[^.]+$/, '').trim();
  return label || 'Audio Track';
}

function isManifestAudioAsset(asset: AssetInfo): boolean {
  return (
    asset.type === 'scene_dialogue_audio' ||
    asset.type === 'scene_music' ||
    asset.type === 'scene_sfx' ||
    asset.type === 'scene_audio_mix' ||
    asset.type === 'final_audio'
  );
}

function collectManifestAudioFiles(assets: AssetInfo[]): TimelineAudioFile[] {
  return assets
    .filter(
      (asset) =>
        isManifestAudioAsset(asset) && isSupportedAudioFileName(asset.path),
    )
    .map((asset) => ({
      assetId: asset.id,
      path: asset.path,
      duration: 0,
    }));
}

function isValidSegmentRange(segment: ServerTimelineSegment): boolean {
  return (
    isFiniteNumber(segment.startTime) &&
    isFiniteNumber(segment.endTime) &&
    segment.endTime > segment.startTime
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function detectMediaTypeFromPath(pathValue: string): 'image' | 'video' | null {
  const normalized = pathValue.trim().toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(normalized)) {
    return 'image';
  }
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(normalized)) {
    return 'video';
  }
  return null;
}

function detectMediaTypeFromAsset(
  asset: AssetInfo | undefined,
): 'image' | 'video' | null {
  if (!asset) return null;
  if (asset.type === 'scene_image') return 'image';
  if (asset.type === 'scene_video') return 'video';
  return detectMediaTypeFromPath(asset.path);
}

function getLayerMetadataFilePath(
  layer: ServerTimelineLayer | undefined,
): string | null {
  const metadata = layer?.metadata;
  if (!isObjectRecord(metadata)) return null;
  const value = metadata['file_path'];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getMetadataString(
  metadata: Record<string, unknown> | undefined,
  ...keys: string[]
): string | null {
  if (!metadata) return null;

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getMetadataNumber(
  metadata: Record<string, unknown> | undefined,
  ...keys: string[]
): number | null {
  if (!metadata) return null;

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function parseIdentityFromText(value: string | undefined): TimelineIdentity {
  if (!value) {
    return {};
  }

  const directMatch =
    value.match(
      /segment[_-](\d+)[_-]shot[_-](\d+)|scene[\s_-]*(\d+)[^\d]+shot[\s_-]*(\d+)/i,
    ) ?? null;
  if (!directMatch) {
    return {};
  }

  const sceneNumber =
    directMatch[1] !== undefined
      ? Number.parseInt(directMatch[1], 10) + 1
      : directMatch[3] !== undefined
        ? Number.parseInt(directMatch[3], 10)
        : undefined;
  const shotNumber =
    directMatch[2] !== undefined
      ? Number.parseInt(directMatch[2], 10)
      : directMatch[4] !== undefined
        ? Number.parseInt(directMatch[4], 10)
        : undefined;

  return {
    sceneNumber: Number.isFinite(sceneNumber) ? sceneNumber : undefined,
    shotNumber: Number.isFinite(shotNumber) ? shotNumber : undefined,
  };
}

function getFirstVisualLayer(
  segment: ServerTimelineSegment,
): ServerTimelineLayer | undefined {
  return (segment.layers ?? []).find((layer) => layer.type === 'visual');
}

function findAssetByArtifactId(
  artifactId: string | undefined,
  assets: AssetInfo[],
): AssetInfo | undefined {
  if (!artifactId) return undefined;
  return assets.find((asset) => asset.id === artifactId);
}

function hasCompleteIdentity(identity: TimelineIdentity): boolean {
  return (
    identity.sceneNumber !== undefined && identity.shotNumber !== undefined
  );
}

function findBestMatchingManifestAsset(
  segmentIdentity: TimelineIdentity,
  assets: AssetInfo[],
  preferredType?: 'image' | 'video',
): AssetInfo | undefined {
  if (!hasCompleteIdentity(segmentIdentity)) {
    return undefined;
  }

  const matchingAssets = assets.filter((asset) => {
    const mediaType = detectMediaTypeFromAsset(asset);
    if (!mediaType) {
      return false;
    }
    if (preferredType && mediaType !== preferredType) {
      return false;
    }

    return isIdentityCompatible(
      segmentIdentity,
      getLayerIdentity(undefined, asset, asset.path),
    );
  });

  if (matchingAssets.length === 0) {
    return undefined;
  }

  return matchingAssets.sort((left, right) => {
    const leftType = detectMediaTypeFromAsset(left);
    const rightType = detectMediaTypeFromAsset(right);

    if (leftType !== rightType) {
      return leftType === 'video' ? -1 : 1;
    }
    if (left.version !== right.version) {
      return right.version - left.version;
    }
    return right.created_at - left.created_at;
  })[0];
}

function getSegmentDeclaredIdentity(
  segment: ServerTimelineSegment,
): TimelineIdentity {
  const visualLayer = getFirstVisualLayer(segment);
  const metadata = isObjectRecord(visualLayer?.metadata)
    ? visualLayer.metadata
    : undefined;
  const textIdentity = [segment.id?.trim(), segment.label?.trim()]
    .map((candidate) => parseIdentityFromText(candidate))
    .find(
      (identity) =>
        identity.sceneNumber !== undefined && identity.shotNumber !== undefined,
    );

  return {
    sceneNumber:
      getMetadataNumber(metadata, 'sceneNumber', 'scene_number') ??
      textIdentity?.sceneNumber,
    shotNumber:
      getMetadataNumber(metadata, 'shotNumber', 'shot_number') ??
      textIdentity?.shotNumber,
  };
}

function getLayerIdentity(
  layer: ServerTimelineLayer | undefined,
  asset?: AssetInfo,
  explicitPath?: string,
): TimelineIdentity {
  // When the caller passes an explicitPath, they want the IDENTITY OF
  // THAT PATH — not the layer/asset's intended identity. A filename
  // like `Scene2_shot1_video.mp4` is authoritative for "what is on
  // disk at this path", which is exactly the corruption we have to
  // detect (asset metadata says scene 1 shot 3, but the active layer
  // points at a Scene2_shot1 file). Parse the path first; only fall
  // through to layer / asset metadata when the path itself doesn't
  // carry identity.
  if (explicitPath) {
    const pathIdentity = parseIdentityFromText(explicitPath);
    if (
      pathIdentity.sceneNumber !== undefined &&
      pathIdentity.shotNumber !== undefined
    ) {
      return pathIdentity;
    }
  }

  const metadata = isObjectRecord(layer?.metadata) ? layer.metadata : undefined;
  const metadataIdentity = {
    sceneNumber: getMetadataNumber(
      metadata,
      'sceneNumber',
      'scene_number',
      'placementNumber',
    ),
    shotNumber: getMetadataNumber(metadata, 'shotNumber', 'shot_number'),
  };

  if (
    metadataIdentity.sceneNumber !== null &&
    metadataIdentity.shotNumber !== null
  ) {
    return {
      sceneNumber: metadataIdentity.sceneNumber ?? undefined,
      shotNumber: metadataIdentity.shotNumber ?? undefined,
    };
  }

  const assetMetadata = isObjectRecord(asset?.metadata) ? asset.metadata : undefined;
  const assetMetadataIdentity = {
    sceneNumber:
      getMetadataNumber(
        assetMetadata,
        'sceneNumber',
        'scene_number',
        'placementNumber',
      ) ??
      asset?.scene_number,
    shotNumber: getMetadataNumber(assetMetadata, 'shotNumber', 'shot_number'),
  };
  if (
    assetMetadataIdentity.sceneNumber !== null &&
    assetMetadataIdentity.sceneNumber !== undefined &&
    assetMetadataIdentity.shotNumber !== null &&
    assetMetadataIdentity.shotNumber !== undefined
  ) {
    return {
      sceneNumber: assetMetadataIdentity.sceneNumber,
      shotNumber: assetMetadataIdentity.shotNumber,
    };
  }

  const textCandidates = [
    explicitPath,
    layer?.filePath,
    asset?.path,
    layer?.artifactId,
    layer?.label,
  ];
  for (const candidate of textCandidates) {
    const identity = parseIdentityFromText(candidate);
    if (
      identity.sceneNumber !== undefined &&
      identity.shotNumber !== undefined
    ) {
      return identity;
    }
  }

  return {
    sceneNumber: assetMetadataIdentity.sceneNumber ?? undefined,
    shotNumber: assetMetadataIdentity.shotNumber ?? undefined,
  };
}

function isIdentityCompatible(
  segmentIdentity: TimelineIdentity,
  candidateIdentity: TimelineIdentity,
): boolean {
  if (
    segmentIdentity.sceneNumber === undefined ||
    segmentIdentity.shotNumber === undefined
  ) {
    return true;
  }

  if (
    candidateIdentity.sceneNumber === undefined ||
    candidateIdentity.shotNumber === undefined
  ) {
    return true;
  }

  return (
    segmentIdentity.sceneNumber === candidateIdentity.sceneNumber &&
    segmentIdentity.shotNumber === candidateIdentity.shotNumber
  );
}

function extractShotIdentity(
  segment: ServerTimelineSegment,
  asset: AssetInfo | undefined,
): { sceneNumber?: number; shotNumber?: number } {
  const visualLayer = getFirstVisualLayer(segment);
  const metadata = isObjectRecord(visualLayer?.metadata)
    ? visualLayer.metadata
    : undefined;
  const assetMetadata = isObjectRecord(asset?.metadata) ? asset.metadata : undefined;

  const candidates = [segment.id?.trim(), segment.label?.trim()].filter(
    (value): value is string => Boolean(value),
  );

  const shotMatch = candidates
    .map((candidate) =>
      candidate.match(
        /segment[_-](\d+)[_-]shot[_-](\d+)|scene[\s_-]*(\d+)[^\d]+shot[\s_-]*(\d+)/i,
      ),
    )
    .find((value): value is RegExpMatchArray => Boolean(value));

  const fromSegmentScene =
    shotMatch?.[1] !== undefined
      ? Number.parseInt(shotMatch[1], 10) + 1
      : shotMatch?.[3] !== undefined
        ? Number.parseInt(shotMatch[3], 10)
        : undefined;
  const fromSegmentShot =
    shotMatch?.[2] !== undefined
      ? Number.parseInt(shotMatch[2], 10)
      : shotMatch?.[4] !== undefined
        ? Number.parseInt(shotMatch[4], 10)
        : undefined;

  const sceneNumber =
    getMetadataNumber(metadata, 'sceneNumber', 'scene_number', 'placementNumber') ??
    getMetadataNumber(assetMetadata, 'sceneNumber', 'scene_number', 'placementNumber') ??
    asset?.scene_number ??
    fromSegmentScene;
  const shotNumber =
    getMetadataNumber(metadata, 'shotNumber', 'shot_number') ??
    getMetadataNumber(assetMetadata, 'shotNumber', 'shot_number') ??
    fromSegmentShot;

  return {
    sceneNumber: sceneNumber ?? undefined,
    shotNumber: shotNumber ?? undefined,
  };
}

function extractShotPrompt(
  segment: ServerTimelineSegment,
  asset: AssetInfo | undefined,
): string | undefined {
  const visualLayer = getFirstVisualLayer(segment);
  const metadata = isObjectRecord(visualLayer?.metadata)
    ? visualLayer.metadata
    : undefined;
  const assetMetadata = isObjectRecord(asset?.metadata) ? asset.metadata : undefined;

  return (
    getMetadataString(metadata, 'prompt', 'shot_prompt', 'image_prompt') ??
    getMetadataString(assetMetadata, 'prompt', 'shot_prompt', 'image_prompt') ??
    undefined
  );
}

function resolveSegmentVisual(
  segment: ServerTimelineSegment,
  assets: AssetInfo[],
): { type: 'image' | 'video'; path: string } | null {
  const visualLayer = getFirstVisualLayer(segment);
  if (!visualLayer) return null;

  if (visualLayer.filePath?.trim()) {
    const path = visualLayer.filePath.trim();
    const type = detectMediaTypeFromPath(path);
    if (type) {
      return { type, path };
    }
  }

  const asset = findAssetByArtifactId(visualLayer.artifactId, assets);
  if (asset?.path?.trim()) {
    const type = detectMediaTypeFromAsset(asset);
    if (type) {
      return { type, path: asset.path.trim() };
    }
  }

  const metadataFilePath = getLayerMetadataFilePath(visualLayer);
  if (metadataFilePath) {
    const type = detectMediaTypeFromPath(metadataFilePath);
    if (type) {
      return { type, path: metadataFilePath };
    }
  }

  return null;
}

export function buildNormalizedServerTimelineData({
  timeline,
  assets,
  segmentOverrides = {},
}: {
  timeline: ServerTimelineDocument | null;
  assets: AssetInfo[];
  segmentOverrides?: Record<string, SegmentTimingOverride>;
}): NormalizedServerTimelineData {
  const validationIssues: TimelineValidationIssue[] = [];
  let repairedCount = 0;
  let droppedCount = 0;

  const items = getTimelineSegments(timeline).map((segment) => {
    const startTime = segment.startTime!;
    const endTime = segment.endTime!;
    const label = segment.label?.trim() || segment.id || 'Segment';
    const sceneLabel = extractSceneLabel(segment);
    const segmentId = segment.id?.trim() || `segment-${startTime}-${endTime}`;
    const fillStatus = segment.fillStatus ?? 'empty';
    const visualLayer = getFirstVisualLayer(segment);
    const asset = findAssetByArtifactId(visualLayer?.artifactId, assets);
    const segmentIdentity = getSegmentDeclaredIdentity(segment);
    const preferredVideoAsset = findBestMatchingManifestAsset(
      segmentIdentity,
      assets,
      'video',
    );
    const preferredImageAsset = findBestMatchingManifestAsset(
      segmentIdentity,
      assets,
      'image',
    );
    const { sceneNumber, shotNumber } = extractShotIdentity(segment, asset);
    const prompt = extractShotPrompt(segment, asset);
    const activePath = visualLayer?.filePath?.trim();
    const activeType = activePath ? detectMediaTypeFromPath(activePath) : null;
    const activeIdentity = getLayerIdentity(visualLayer, asset, activePath);
    const activePathMatches =
      activeType !== null && isIdentityCompatible(segmentIdentity, activeIdentity);
    const assetType = detectMediaTypeFromAsset(asset);
    const assetPath = asset?.path?.trim();
    const assetMatches =
      assetType !== null &&
      Boolean(assetPath) &&
      isIdentityCompatible(
        segmentIdentity,
        getLayerIdentity(visualLayer, asset, assetPath),
      );
    const metadataFilePath = getLayerMetadataFilePath(visualLayer);
    const metadataType = metadataFilePath
      ? detectMediaTypeFromPath(metadataFilePath)
      : null;
    const metadataMatches =
      metadataType !== null &&
      isIdentityCompatible(
        segmentIdentity,
        getLayerIdentity(visualLayer, asset, metadataFilePath ?? undefined),
      );

    let resolvedVisual: { type: 'image' | 'video'; path: string } | null = null;
    if (activeType === 'video' && activePathMatches && activePath) {
      resolvedVisual = { type: 'video', path: activePath };
    } else if (preferredVideoAsset?.path?.trim()) {
      resolvedVisual = {
        type: 'video',
        path: preferredVideoAsset.path.trim(),
      };
      if (fillStatus === 'filled' && activePath !== resolvedVisual.path) {
        repairedCount += 1;
        validationIssues.push({
          segmentId,
          code:
            activeType === 'image'
              ? 'video_preferred_over_image'
              : 'recovered_from_manifest',
          message:
            activeType === 'image'
              ? `Recovered ${label} by preferring the matching manifest video over a stale image-backed active layer.`
              : `Recovered ${label} from manifest-backed asset data after stale active media mismatch.`,
        });
      }
    } else if (activeType && activePathMatches && activePath) {
      resolvedVisual = { type: activeType, path: activePath };
    } else if (assetType && assetMatches && assetPath) {
      resolvedVisual = { type: assetType, path: assetPath };
      if (fillStatus === 'filled' && activeType && activePath && activePath !== assetPath) {
        repairedCount += 1;
        validationIssues.push({
          segmentId,
          code: 'recovered_from_manifest',
          message: `Recovered ${label} from manifest-backed asset data after stale active media mismatch.`,
        });
      }
    } else if (preferredImageAsset?.path?.trim()) {
      resolvedVisual = {
        type: 'image',
        path: preferredImageAsset.path.trim(),
      };
    } else if (metadataType && metadataFilePath && metadataMatches) {
      resolvedVisual = { type: metadataType, path: metadataFilePath };
    }

    if (fillStatus === 'filled' && resolvedVisual) {
      return {
        id: segmentId,
        type: resolvedVisual.type,
        startTime,
        endTime,
        duration: endTime - startTime,
        label,
        sceneLabel,
        sceneNumber,
        shotNumber,
        prompt,
        segmentId,
        sourceType: 'server_timeline' as const,
        mediaTypeContext: resolvedVisual.type,
        mediaPathContext: resolvedVisual.path,
        imagePath:
          resolvedVisual.type === 'image' ? resolvedVisual.path : undefined,
        videoPath:
          resolvedVisual.type === 'video' ? resolvedVisual.path : undefined,
        sourceStartTime: startTime,
        sourceEndTime: endTime,
      } satisfies TimelineItem;
    }

    if (fillStatus === 'filled') {
      droppedCount += 1;
      validationIssues.push({
        segmentId,
        code:
          activeType && activePath && !activePathMatches
            ? 'dropped_invalid_visual'
            : 'missing_visual',
        message:
          activeType && activePath && !activePathMatches
            ? `${label} referenced media from a different scene or shot and was dropped at runtime.`
            : `${label} is marked filled but has no usable active visual.`,
      });
    }

    return {
      ...createPlaceholderItem(startTime, endTime, segmentId, label),
      sceneLabel,
    };
  });

  return {
    items: applySegmentTimingOverridesToItems(items, segmentOverrides).sort(
      (a, b) => a.startTime - b.startTime,
    ),
    validationIssues,
    normalizationSummary: {
      repairedCount,
      droppedCount,
    },
    isNormalizedFromCorruption: repairedCount > 0 || droppedCount > 0,
  };
}

function createPlaceholderItem(
  startTime: number,
  endTime: number,
  id?: string,
  label: string = 'Original Footage',
): TimelineItem {
  return {
    id: id || `placeholder-${startTime}-${endTime}`,
    type: 'placeholder',
    startTime,
    endTime,
    duration: endTime - startTime,
    label,
  };
}

function fillGapsWithPlaceholders(
  timelineItems: TimelineItem[],
  totalDuration: number,
): TimelineItem[] {
  const allItems: TimelineItem[] = [];
  let currentTime = 0;

  const sorted = [...timelineItems].sort((a, b) => a.startTime - b.startTime);

  for (const item of sorted) {
    if (item.startTime > currentTime) {
      allItems.push(createPlaceholderItem(currentTime, item.startTime));
    }
    allItems.push(item);
    currentTime = Math.max(currentTime, item.endTime);
  }

  if (currentTime < totalDuration) {
    allItems.push(createPlaceholderItem(currentTime, totalDuration));
  }

  return allItems;
}

function getTimelineSegments(
  timeline: ServerTimelineDocument | null,
): ServerTimelineSegment[] {
  if (!timeline || !Array.isArray(timeline.segments)) {
    return [];
  }

  return timeline.segments.filter(isValidSegmentRange);
}

function extractSceneLabel(segment: ServerTimelineSegment): string | undefined {
  const candidates = [segment.id?.trim(), segment.label?.trim()].filter(
    (value): value is string => Boolean(value),
  );

  const matchedLabel = candidates
    .map((candidate) => {
      const shotMatch = candidate.match(/segment[_-](\d+)[_-]shot[_-]\d+/i);
      if (shotMatch) {
        return `Scene ${parseInt(shotMatch[1] || '0', 10) + 1}`;
      }

      const segmentMatch = candidate.match(/^segment[_-](\d+)$/i);
      if (segmentMatch) {
        return `Scene ${parseInt(segmentMatch[1] || '0', 10) + 1}`;
      }

      const sceneMatch = candidate.match(/\bscene[\s_-]*(\d+)\b/i);
      if (sceneMatch) {
        return `Scene ${parseInt(sceneMatch[1] || '0', 10)}`;
      }

      return null;
    })
    .find((value): value is string => Boolean(value));

  return matchedLabel || undefined;
}

export function getTimelineFileState(
  content: string | null,
): TimelineFileState {
  if (!content) {
    return {
      source: 'none',
      timeline: null,
      error: null,
    };
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isObjectRecord(parsed)) {
      return {
        source: 'none',
        timeline: null,
        error: 'timeline.json is invalid.',
      };
    }

    const timeline = parsed as ServerTimelineDocument;
    if (!Array.isArray(timeline.segments)) {
      return {
        source: 'none',
        timeline: null,
        error: 'timeline.json is missing a segments array.',
      };
    }

    return {
      source: 'server_timeline',
      timeline,
      error: null,
    };
  } catch (error) {
    return {
      source: 'none',
      timeline: null,
      error:
        error instanceof Error
          ? `timeline.json is invalid: ${error.message}`
          : 'timeline.json is invalid.',
    };
  }
}

export function buildServerTimelineItems({
  timeline,
  assets,
  segmentOverrides = {},
}: {
  timeline: ServerTimelineDocument | null;
  assets: AssetInfo[];
  segmentOverrides?: Record<string, SegmentTimingOverride>;
}): TimelineItem[] {
  return buildNormalizedServerTimelineData({
    timeline,
    assets,
    segmentOverrides,
  }).items;
}

export async function collectAudioFilesWithDuration({
  audioFiles,
  projectDirectory,
  transcriptDuration,
  getAudioDuration,
}: {
  audioFiles: TimelineAudioFile[];
  projectDirectory: string;
  transcriptDuration: number;
  getAudioDuration: (audioPath: string) => Promise<number>;
}): Promise<TimelineAudioFile[]> {
  const durationResults = await Promise.allSettled(
    audioFiles.map(async (audioFile) => {
      const fullAudioPath = `${projectDirectory}/${audioFile.path}`;
      const duration = await getAudioDuration(fullAudioPath);
      return duration;
    }),
  );

  return audioFiles.map((audioFile, index) => {
    const durationResult = durationResults[index];
    const duration =
      durationResult?.status === 'fulfilled'
        ? durationResult.value
        : transcriptDuration || 0;
    return {
      ...audioFile,
      duration,
    };
  });
}

function collectScannedAudioFiles(files: FileNode): TimelineAudioFile[] {
  const audioEntries = (files.children ?? []).filter(
    (file): file is FileNode & { type: 'file'; name: string } =>
      file.type === 'file' && isSupportedAudioFileName(file.name),
  );

  return audioEntries.map((file) => ({
    path: `${PROJECT_PATHS.AGENT_AUDIO}/${file.name}`,
    duration: 0,
  }));
}

export async function attachWaveformPeaksToAudioFiles({
  audioFiles,
  projectDirectory,
  getAudioWaveform,
}: {
  audioFiles: TimelineAudioFile[];
  projectDirectory: string;
  getAudioWaveform: (
    audioPath: string,
    options?: { sampleCount?: number },
  ) => Promise<{ peaks: number[]; duration: number }>;
}): Promise<TimelineAudioFile[]> {
  const waveformResults = await Promise.allSettled(
    audioFiles.map(async (audioFile) => {
      const fullAudioPath = `${projectDirectory}/${audioFile.path}`;
      const waveformResult = await getAudioWaveform(fullAudioPath);
      return {
        ...audioFile,
        duration:
          waveformResult.duration > 0
            ? waveformResult.duration
            : audioFile.duration,
        waveformPeaks:
          Array.isArray(waveformResult.peaks) &&
          waveformResult.peaks.length > 0
            ? waveformResult.peaks
            : undefined,
      } satisfies TimelineAudioFile;
    }),
  );

  return audioFiles.map((audioFile, index) => {
    const waveformResult = waveformResults[index];
    return waveformResult?.status === 'fulfilled'
      ? waveformResult.value
      : audioFile;
  });
}

export async function runLatestAsyncTask<T>({
  requestRef,
  task,
  commit,
}: {
  requestRef: LatestRequestRef;
  task: () => Promise<T>;
  commit: (result: T) => void;
}): Promise<boolean> {
  const requestId = requestRef.current + 1;
  requestRef.current = requestId;

  const result = await task();
  if (requestId !== requestRef.current) {
    return false;
  }

  commit(result);
  return true;
}

export function useTimelineData(
  _activeVersions?: Record<number, SceneVersions>,
): TimelineDataWithRefresh {
  const { isLoaded, assetManifest, timelineState, refreshAssetManifest } =
    useProject();
  const { projectDirectory } = useWorkspace();
  const { totalDuration: transcriptDuration } = useTranscript();
  const [audioFiles, setAudioFiles] = useState<TimelineAudioFile[]>([]);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [timelineFileState, setTimelineFileState] = useState<TimelineFileState>(
    {
      source: 'none',
      timeline: null,
      error: null,
    },
  );
  const audioReloadRequestIdRef = useRef(0);
  const timelineReloadRequestIdRef = useRef(0);
  const deferredAudioReloadRef = useRef<number | null>(null);

  const clearDeferredAudioReload = useCallback(() => {
    if (deferredAudioReloadRef.current === null) {
      return;
    }

    if (typeof window !== 'undefined' && window.cancelIdleCallback) {
      window.cancelIdleCallback(deferredAudioReloadRef.current);
    } else {
      window.clearTimeout(deferredAudioReloadRef.current);
    }
    deferredAudioReloadRef.current = null;
  }, []);

  const loadTimelineFile = useCallback(async () => {
    if (!projectDirectory || !isLoaded) {
      timelineReloadRequestIdRef.current += 1;
      setIsTimelineLoading(false);
      setTimelineFileState((prev) =>
        prev.source === 'none' && prev.timeline === null && prev.error === null
          ? prev
          : {
              source: 'none',
              timeline: null,
              error: null,
            },
      );
      return;
    }

    setIsTimelineLoading(true);
    await runLatestAsyncTask({
      requestRef: timelineReloadRequestIdRef,
      task: async () => {
        const timelinePath = `${projectDirectory}/timeline.json`;
        const content = await window.electron.project
          .readFile(timelinePath)
          .catch(() => null);
        return getTimelineFileState(content);
      },
      commit: (nextState) => {
        setTimelineFileState(nextState);
        setIsTimelineLoading(false);
      },
    });
  }, [projectDirectory, isLoaded]);

  const reloadAudioFiles = useCallback(async () => {
    if (!projectDirectory || !isLoaded) {
      audioReloadRequestIdRef.current += 1;
      setIsAudioLoading(false);
      setAudioFiles((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const requestId = audioReloadRequestIdRef.current + 1;
    audioReloadRequestIdRef.current = requestId;
    setIsAudioLoading(true);

    const start =
      process.env.NODE_ENV === 'development' ? performance.now() : 0;

    try {
      const audioDir = `${projectDirectory}/${PROJECT_PATHS.AGENT_AUDIO}`;
      const files = await window.electron.project.readTree(audioDir, 1);
      const manifestAudioFiles = collectManifestAudioFiles(
        assetManifest?.assets ?? [],
      );
      const scannedAudioFiles = collectScannedAudioFiles(files);
      const mergedAudioFiles = Array.from(
        new Map(
          [...scannedAudioFiles, ...manifestAudioFiles].map((audioFile) => [
            audioFile.path,
            audioFile,
          ]),
        ).values(),
      );
      const nextAudioFiles = await collectAudioFilesWithDuration({
        audioFiles: mergedAudioFiles,
        projectDirectory,
        transcriptDuration,
        getAudioDuration: (audioPath: string) =>
          window.electron.project.getAudioDuration(audioPath),
      });

      if (requestId !== audioReloadRequestIdRef.current) {
        return;
      }

      setAudioFiles(nextAudioFiles);
      setIsAudioLoading(false);

      if (nextAudioFiles.length === 0) {
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.debug(
            `[perf][useTimelineData] reloadAudioFiles ${(performance.now() - start).toFixed(1)}ms (no_audio)`,
          );
        }
        return;
      }

      const waveformStart =
        process.env.NODE_ENV === 'development' ? performance.now() : 0;
      void attachWaveformPeaksToAudioFiles({
        audioFiles: nextAudioFiles,
        projectDirectory,
        getAudioWaveform: (audioPath: string, options) =>
          window.electron.project.getAudioWaveform(audioPath, options),
      })
        .then((audioFilesWithWaveforms) => {
          if (requestId !== audioReloadRequestIdRef.current) {
            return;
          }
          setAudioFiles(audioFilesWithWaveforms);
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.debug(
              `[perf][useTimelineData] attachWaveforms ${(performance.now() - waveformStart).toFixed(1)}ms`,
            );
          }
        })
        .catch((error) => {
          debugRendererDebug(
            '[useTimelineData] Failed to attach audio waveforms:',
            error,
          );
        });

      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.debug(
          `[perf][useTimelineData] reloadAudioFiles(base) ${(performance.now() - start).toFixed(1)}ms`,
        );
      }
    } catch (error) {
      if (requestId !== audioReloadRequestIdRef.current) {
        return;
      }

      debugRendererDebug(
        '[useTimelineData] Audio directory not found or error loading:',
        error,
      );
      const manifestAudioFiles = collectManifestAudioFiles(
        assetManifest?.assets ?? [],
      );
      setAudioFiles(manifestAudioFiles);
      setIsAudioLoading(false);
    }
  }, [projectDirectory, isLoaded, transcriptDuration, assetManifest]);

  useEffect(() => {
    void loadTimelineFile();
  }, [loadTimelineFile]);

  useEffect(() => {
    clearDeferredAudioReload();

    if (!projectDirectory || !isLoaded) {
      void reloadAudioFiles();
      return () => {
        clearDeferredAudioReload();
      };
    }

    const scheduleReload = () => {
      deferredAudioReloadRef.current = null;
      void reloadAudioFiles();
    };

    if (typeof window !== 'undefined' && window.requestIdleCallback) {
      deferredAudioReloadRef.current = window.requestIdleCallback(
        scheduleReload,
        { timeout: 1200 },
      );
    } else {
      deferredAudioReloadRef.current = window.setTimeout(scheduleReload, 250);
    }

    return () => {
      clearDeferredAudioReload();
    };
  }, [projectDirectory, isLoaded, reloadAudioFiles, clearDeferredAudioReload]);

  useEffect(() => {
    if (!projectDirectory) return;

    const normalizedTimelinePath = `${projectDirectory}/timeline.json`.replace(
      /\\/g,
      '/',
    );

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.electron.project.onFileChange((event) => {
      const filePath = event.path.replace(/\\/g, '/');
      const isTimelineFile = filePath === normalizedTimelinePath;
      const isAudioFile = filePath.includes(`/${PROJECT_PATHS.AGENT_AUDIO}/`);

      if (!isTimelineFile && !isAudioFile) return;

      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      debounceTimeout = setTimeout(() => {
        if (isTimelineFile) {
          void loadTimelineFile();
        }
        if (isAudioFile) {
          clearDeferredAudioReload();
          void reloadAudioFiles();
        }
        debounceTimeout = null;
      }, 250);
    });

    return () => {
      unsubscribe();
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
    };
  }, [
    projectDirectory,
    loadTimelineFile,
    reloadAudioFiles,
    clearDeferredAudioReload,
  ]);

  const refreshTimeline = useCallback(async () => {
    await Promise.all([
      loadTimelineFile(),
      refreshAssetManifest ? refreshAssetManifest() : Promise.resolve(),
    ]);
  }, [loadTimelineFile, refreshAssetManifest]);

  const refreshAudioFiles = useCallback(async () => {
    clearDeferredAudioReload();
    await reloadAudioFiles();
  }, [reloadAudioFiles, clearDeferredAudioReload]);

  const baseTimelineItems = useMemo(() => {
    if (timelineFileState.source !== 'server_timeline') {
      return {
        items: [],
        validationIssues: [],
        normalizationSummary: {
          repairedCount: 0,
          droppedCount: 0,
        },
        isNormalizedFromCorruption: false,
      } satisfies NormalizedServerTimelineData;
    }

    return buildNormalizedServerTimelineData({
      timeline: timelineFileState.timeline,
      assets: assetManifest?.assets ?? [],
      segmentOverrides: timelineState.segment_timing_overrides ?? {},
    });
  }, [
    timelineFileState.source,
    timelineFileState.timeline,
    assetManifest,
    timelineState.segment_timing_overrides,
  ]);

  const textOverlayItems: TimelineItem[] = useMemo(() => [], []);

  const serverSegments = useMemo(
    () => getTimelineSegments(timelineFileState.timeline),
    [timelineFileState.timeline],
  );

  const serverTimelineDuration = useMemo(() => {
    if (timelineFileState.source !== 'server_timeline') {
      return 0;
    }

    const configuredDuration = timelineFileState.timeline?.totalDuration;
    if (isFiniteNumber(configuredDuration) && configuredDuration > 0) {
      return configuredDuration;
    }

    if (serverSegments.length === 0) {
      return 0;
    }

    return Math.max(...serverSegments.map((segment) => segment.endTime ?? 0));
  }, [timelineFileState.source, timelineFileState.timeline, serverSegments]);

  const error = useMemo(() => {
    if (timelineFileState.source !== 'server_timeline') {
      return timelineFileState.error;
    }

    const configuredDuration = timelineFileState.timeline?.totalDuration;
    if (!isFiniteNumber(configuredDuration) && serverSegments.length > 0) {
      return 'timeline.json is missing a valid totalDuration; using the last segment end time.';
    }

    return timelineFileState.error;
  }, [timelineFileState, serverSegments]);

  const calculatedTotalDuration = useMemo(() => {
    const maxAudioDuration =
      audioFiles.length > 0
        ? Math.max(...audioFiles.map((audioFile) => audioFile.duration || 0))
        : 0;

    return Math.max(
      serverTimelineDuration,
      maxAudioDuration,
      transcriptDuration || 0,
    );
  }, [audioFiles, serverTimelineDuration, transcriptDuration]);

  const timelineItems = useMemo(() => {
    const visualItems =
      timelineFileState.source === 'server_timeline'
        ? calculatedTotalDuration > 0
          ? fillGapsWithPlaceholders(baseTimelineItems.items, calculatedTotalDuration)
          : [...baseTimelineItems.items]
        : [];
    const items = [...visualItems];

    audioFiles.forEach((audioFile, index) => {
      items.push({
        id: audioFile.assetId ?? `audio-${index}`,
        assetId: audioFile.assetId,
        type: 'audio',
        startTime: 0,
        endTime: audioFile.duration || calculatedTotalDuration,
        duration: audioFile.duration || calculatedTotalDuration,
        label: getAudioLabelFromPath(audioFile.path),
        audioPath: audioFile.path,
        waveformPeaks: audioFile.waveformPeaks,
      });
    });

    items.sort((a, b) => a.startTime - b.startTime);
    return items;
  }, [
    audioFiles,
    baseTimelineItems,
    calculatedTotalDuration,
    timelineFileState.source,
  ]);

  return {
    timelineItems,
    overlayItems: [],
    textOverlayItems,
    textOverlayCues: [],
    totalDuration: calculatedTotalDuration,
    refreshTimeline,
    refreshAudioFiles,
    timelineSource: timelineFileState.source,
    error,
    isTimelineLoading,
    isAudioLoading,
    validationIssues: baseTimelineItems.validationIssues,
    normalizationSummary: baseTimelineItems.normalizationSummary,
    isNormalizedFromCorruption: baseTimelineItems.isNormalizedFromCorruption,
  };
}
