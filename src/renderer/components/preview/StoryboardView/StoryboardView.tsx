import { useState, useMemo, useCallback } from 'react';
import { Grid, List, Film } from 'lucide-react';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useProject } from '../../../contexts/ProjectContext';
import { useTimelineDataContext } from '../../../contexts/TimelineDataContext';
import type { StoryboardScene, Artifact } from '../../../types/projectState';
import SceneCard from '../SceneCard';
import styles from './StoryboardView.module.scss';

type FilterType = 'all' | 'drafts' | 'final';
type ViewType = 'grid' | 'list';

export default function StoryboardView() {
  const { projectDirectory } = useWorkspace();
  const { isLoaded, isLoading, scenes: projectScenes } = useProject();
  const { timelineItems } = useTimelineDataContext();
  const [filter, setFilter] = useState<FilterType>('all');
  const [viewType, setViewType] = useState<ViewType>('grid');

  // Derive scenes from timeline items when project.json has no scene data.
  // Group timeline items by sceneNumber and produce one StoryboardScene per unique scene.
  const timelineDerivedScenes: StoryboardScene[] = useMemo(() => {
    const seen = new Map<number, StoryboardScene>();
    for (const item of timelineItems) {
      if (item.sceneNumber == null) continue;
      if (!seen.has(item.sceneNumber)) {
        seen.set(item.sceneNumber, {
          scene_number: item.sceneNumber,
          name: item.sceneLabel || `Scene ${item.sceneNumber}`,
          description: '',
          duration: 5,
          shot_type: 'Mid Shot',
          lighting: 'Natural',
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.scene_number - b.scene_number);
  }, [timelineItems]);

  // Convert SceneRef from ProjectContext to StoryboardScene format for SceneCard compatibility.
  // Falls back to timeline-derived scenes when project.json has no scene data.
  const scenes: StoryboardScene[] = useMemo(() => {
    if (isLoaded && projectScenes.length > 0) {
      return projectScenes.map((scene) => ({
        scene_number: scene.scene_number,
        name: scene.title,
        description: scene.description || '',
        duration: 5,
        shot_type: 'Mid Shot',
        lighting: 'Natural',
      }));
    }
    return timelineDerivedScenes;
  }, [isLoaded, projectScenes, timelineDerivedScenes]);

  // Create a map of scene numbers to folder names
  const sceneFoldersByNumber = useMemo(() => {
    const map: Record<number, string> = {};
    for (const scene of projectScenes) {
      map[scene.scene_number] = scene.folder;
    }
    return map;
  }, [projectScenes]);

  // Build artifacts map: prefer project.json image paths, fall back to timeline item paths.
  const artifactsByScene: Record<number, Artifact> = useMemo(() => {
    const map: Record<number, Artifact> = {};

    for (const scene of projectScenes) {
      if (scene.image_approval_status === 'approved' && scene.image_path) {
        map[scene.scene_number] = {
          artifact_id: scene.image_artifact_id || `scene-${scene.scene_number}-image`,
          artifact_type: 'image',
          scene_number: scene.scene_number,
          file_path: scene.image_path,
          created_at: new Date().toISOString(),
        };
      }
    }

    // For timeline-derived scenes, pick up image/video paths from timeline items
    for (const item of timelineItems) {
      if (item.sceneNumber == null) continue;
      if (map[item.sceneNumber]) continue;
      if (item.imagePath) {
        map[item.sceneNumber] = {
          artifact_id: item.id,
          artifact_type: 'image',
          scene_number: item.sceneNumber,
          file_path: item.imagePath,
          created_at: new Date().toISOString(),
        };
      }
    }

    return map;
  }, [projectScenes, timelineItems]);

  // Filter scenes based on status
  const filteredScenes = useMemo(() => {
    return scenes.filter((scene) => {
      if (filter === 'all') return true;
      const hasArtifact = !!artifactsByScene[scene.scene_number];
      if (filter === 'final') return hasArtifact;
      if (filter === 'drafts') return !hasArtifact;
      return true;
    });
  }, [scenes, filter, artifactsByScene]);

  const handleExpand = useCallback((scene: StoryboardScene) => {
    // TODO: Implement scene expansion/preview
    console.log('Expand scene:', scene.scene_number);
  }, []);

  const handleRegenerate = useCallback((scene: StoryboardScene) => {
    // TODO: Implement scene regeneration
    console.log('Regenerate scene:', scene.scene_number);
  }, []);

  const handleNameChange = useCallback(
    async (sceneNumber: number, name: string) => {
      // TODO: Implement name change via ProjectContext
      console.log('Name change:', sceneNumber, name);
    },
    [],
  );

  // Show empty state if no project
  if (!projectDirectory) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <Film size={48} className={styles.emptyIcon} />
          <h3>No Project Open</h3>
          <p>Open a project to view the storyboard</p>
        </div>
      </div>
    );
  }

  // Show loading state only when project is loading and no timeline fallback available
  if (isLoading && scenes.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading storyboard...</div>
      </div>
    );
  }

  // Show empty state if both project.json and timeline have no scene data
  if (scenes.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <Film size={48} className={styles.emptyIcon} />
          <h3>No Scenes Yet</h3>
          <p>Start a conversation to generate your storyboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.filterBar}>
          <span className={styles.filterLabel}>Filter by:</span>
          <div className={styles.filterButtons}>
            <button
              type="button"
              className={`${styles.filterButton} ${filter === 'all' ? styles.active : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({scenes.length})
            </button>
            <button
              type="button"
              className={`${styles.filterButton} ${filter === 'drafts' ? styles.active : ''}`}
              onClick={() => setFilter('drafts')}
            >
              Drafts
            </button>
            <button
              type="button"
              className={`${styles.filterButton} ${filter === 'final' ? styles.active : ''}`}
              onClick={() => setFilter('final')}
            >
              Final
            </button>
          </div>
        </div>

        <div className={styles.viewToggle}>
          <button
            type="button"
            className={`${styles.viewButton} ${viewType === 'grid' ? styles.active : ''}`}
            onClick={() => setViewType('grid')}
            title="Grid view"
          >
            <Grid size={16} />
          </button>
          <button
            type="button"
            className={`${styles.viewButton} ${viewType === 'list' ? styles.active : ''}`}
            onClick={() => setViewType('list')}
            title="List view"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      <div
        className={`${styles.content} ${viewType === 'list' ? styles.listView : ''}`}
      >
        {filteredScenes.length === 0 ? (
          <div className={styles.emptyState}>
            <Film size={32} className={styles.emptyIcon} />
            <p>No scenes match the current filter</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {filteredScenes.map((scene) => (
              <SceneCard
                key={scene.scene_number}
                scene={scene}
                artifact={artifactsByScene[scene.scene_number]}
                projectDirectory={projectDirectory || '/mock'}
                sceneFolder={sceneFoldersByNumber[scene.scene_number]}
                onExpand={handleExpand}
                onRegenerate={handleRegenerate}
                onNameChange={handleNameChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
