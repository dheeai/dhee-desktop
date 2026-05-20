import React, { useMemo } from 'react';
import { FileImage, FileVideo } from 'lucide-react';
import { useProject } from '../../../contexts/ProjectContext';
import type { SceneVersions } from '../../../types/dhee/timeline';
import type { TimelineItem } from '../../../hooks/useTimelineData';
import styles from './VersionSelector.module.scss';

export interface PlacementVersion {
  placementNumber: number;
  itemType: 'image' | 'video';
  itemLabel: string;
  imageVersions: number[];
  videoVersions: number[];
}

interface VersionSelectorProps {
  timelineItems: TimelineItem[];
  activeVersions?: Record<number, SceneVersions>; // placementNumber -> { image?: number, video?: number }
  onVersionSelect?: (
    placementNumber: number,
    assetType: 'image' | 'video',
    version: number,
  ) => void;
}

export default function VersionSelector({
  timelineItems,
  activeVersions = {},
  onVersionSelect,
}: VersionSelectorProps) {
  const { assetManifest } = useProject();

  // Get versions from asset manifest, grouped by placementNumber AND timeline item type
  const placementVersions = useMemo(() => {
    if (!assetManifest?.assets || timelineItems.length === 0) {
      return [];
    }

    // Group by placementNumber + item type to separate image and video placements
    const versionMap = new Map<string, PlacementVersion>();

    timelineItems.forEach((item) => {
      // Skip placeholders and items without placement numbers
      if (
        item.placementNumber === undefined ||
        item.type === 'placeholder' ||
        (item.type !== 'image' && item.type !== 'video')
      ) {
        return;
      }

      // Create unique key: "image-1" or "video-1"
      const key = `${item.type}-${item.placementNumber}`;

      // Skip if we already processed this combination
      if (versionMap.has(key)) {
        return;
      }

      // Find assets matching this placement number
      const imageAssets = assetManifest.assets.filter(
        (asset) =>
          asset.type === 'scene_image' &&
          (asset.metadata?.placementNumber === item.placementNumber ||
            asset.scene_number === item.placementNumber),
      );
      const videoAssets = assetManifest.assets.filter(
        (asset) =>
          asset.type === 'scene_video' &&
          (asset.metadata?.placementNumber === item.placementNumber ||
            asset.scene_number === item.placementNumber),
      );

      // Extract and sort version numbers - only for the matching type
      // For image items, only store image versions
      // For video items, only store video versions
      const imageVersions =
        item.type === 'image'
          ? imageAssets.map((asset) => asset.version).sort((a, b) => a - b)
          : [];
      const videoVersions =
        item.type === 'video'
          ? videoAssets.map((asset) => asset.version).sort((a, b) => a - b)
          : [];

      // Only create entry if there are versions for the matching type
      const hasMatchingVersions =
        (item.type === 'image' && imageVersions.length > 0) ||
        (item.type === 'video' && videoVersions.length > 0);

      // Ensure label exists, fallback to generated label if missing
      let itemLabel = item.label || '';
      if (!itemLabel) {
        if (item.type === 'image') {
          itemLabel = `PLM-${item.placementNumber}`;
        } else {
          itemLabel = `vd-placement-${item.placementNumber}`;
        }
      }

      if (hasMatchingVersions) {
        versionMap.set(key, {
          placementNumber: item.placementNumber,
          itemType: item.type,
          itemLabel,
          imageVersions, // Only populated for image items
          videoVersions, // Only populated for video items
        });
      }
    });

    // Convert map to array and sort by placement number, then by type (image first)
    return Array.from(versionMap.values()).sort((a, b) => {
      if (a.placementNumber !== b.placementNumber) {
        return a.placementNumber - b.placementNumber;
      }
      // If same placement number, image comes before video
      return a.itemType === 'image' ? -1 : 1;
    });
  }, [assetManifest, timelineItems]);

  const handleVersionClick = (
    placementNumber: number,
    assetType: 'image' | 'video',
    version: number,
  ): void => {
    if (onVersionSelect) {
      onVersionSelect(placementNumber, assetType, version);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Versions</span>
      </div>
      <div className={styles.versionsList}>
        {placementVersions.map((placementVersion) => {
          const activeVersionsForPlacement =
            activeVersions[placementVersion.placementNumber] || {};

          // Only show versions for the matching timeline item type
          const showImageVersions =
            placementVersion.itemType === 'image' &&
            placementVersion.imageVersions.length > 0;
          const showVideoVersions =
            placementVersion.itemType === 'video' &&
            placementVersion.videoVersions.length > 0;

          if (!showImageVersions && !showVideoVersions) {
            return null;
          }

          const activeImageVersion =
            activeVersionsForPlacement.image ??
            placementVersion.imageVersions[0];
          const activeVideoVersion =
            activeVersionsForPlacement.video ??
            placementVersion.videoVersions[0];

          // Format label: convert "PLM-1" to "PLM_01", "vd-placement-1" to "vd-placement-1"
          // Fallback to generating label from placement number if label is missing
          let displayLabel = placementVersion.itemLabel || '';
          if (!displayLabel) {
            // Generate label from placement number and type
            if (placementVersion.itemType === 'image') {
              displayLabel = `PLM_${String(placementVersion.placementNumber).padStart(2, '0')}`;
            } else {
              displayLabel = `vd-placement-${placementVersion.placementNumber}`;
            }
          } else {
            displayLabel = displayLabel
              .replace(/-/g, '_')
              .replace(
                /PLM_(\d+)/,
                (_, num) => `PLM_${String(num).padStart(2, '0')}`,
              );
          }

          return (
            <div
              key={`${placementVersion.itemType}-${placementVersion.placementNumber}`}
              className={styles.sceneVersions}
            >
              <div className={styles.sceneLabel}>{displayLabel}</div>

              {/* Image Versions - Only show for image timeline items */}
              {showImageVersions && (
                <div className={styles.assetTypeSection}>
                  <div className={styles.assetTypeLabel}>
                    <FileImage size={12} />
                    <span>Image</span>
                  </div>
                  <div className={styles.versionBadges}>
                    {placementVersion.imageVersions.map((version) => {
                      const isActive = version === activeImageVersion;
                      return (
                        <button
                          key={`image-${version}`}
                          type="button"
                          className={`${styles.versionBadge} ${isActive ? styles.active : ''}`}
                          onClick={() =>
                            handleVersionClick(
                              placementVersion.placementNumber,
                              'image',
                              version,
                            )
                          }
                          title={`Placement ${placementVersion.placementNumber} - Image Version ${version}`}
                        >
                          v{version}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Video Versions - Only show for video timeline items */}
              {showVideoVersions && (
                <div className={styles.assetTypeSection}>
                  <div className={styles.assetTypeLabel}>
                    <FileVideo size={12} />
                    <span>Video</span>
                  </div>
                  <div className={styles.versionBadges}>
                    {placementVersion.videoVersions.map((version) => {
                      const isActive = version === activeVideoVersion;
                      return (
                        <button
                          key={`video-${version}`}
                          type="button"
                          className={`${styles.versionBadge} ${isActive ? styles.active : ''}`}
                          onClick={() =>
                            handleVersionClick(
                              placementVersion.placementNumber,
                              'video',
                              version,
                            )
                          }
                          title={`Placement ${placementVersion.placementNumber} - Video Version ${version}`}
                        >
                          v{version}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
