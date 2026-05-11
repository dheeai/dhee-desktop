import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { ProjectState, StoryboardScene } from '../types/projectState';

export interface TimelineContextType {
  // Scene selection
  selectedScenes: Set<number>;
  selectScene: (sceneNumber: number, multi?: boolean, range?: boolean) => void;
  clearSelection: () => void;

  // Drag and drop
  draggedSceneNumber: number | null;
  dropInsertIndex: number | null;
  startDrag: (sceneNumber: number) => void;
  endDrag: () => void;
  setDropIndex: (index: number | null) => void;

  // Scene reordering
  reorderScenes: (
    draggedSceneNum: number,
    insertIndex: number,
    projectState: ProjectState | null,
    projectDirectory: string | null,
    onStateUpdate: (state: ProjectState) => void,
  ) => Promise<void>;
}

const TimelineContext = createContext<TimelineContextType | null>(null);

interface TimelineProviderProps {
  children: ReactNode;
}

export function TimelineProvider({ children }: TimelineProviderProps) {
  const [selectedScenes, setSelectedScenes] = useState<Set<number>>(new Set());
  const [lastSelectedScene, setLastSelectedScene] = useState<number | null>(
    null,
  );
  const [draggedSceneNumber, setDraggedSceneNumber] = useState<number | null>(
    null,
  );
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);

  const selectScene = useCallback(
    (sceneNumber: number, multi = false, range = false) => {
      setSelectedScenes((prev) => {
        const newSet = new Set(prev);
        if (range && lastSelectedScene !== null) {
          // Range selection: select all scenes between last selected and current
          const [from, to] =
            lastSelectedScene < sceneNumber
              ? [lastSelectedScene, sceneNumber]
              : [sceneNumber, lastSelectedScene];
          for (let i = from; i <= to; i += 1) {
            newSet.add(i);
          }
        } else if (multi) {
          // Multi-select: toggle this scene
          if (newSet.has(sceneNumber)) {
            newSet.delete(sceneNumber);
          } else {
            newSet.add(sceneNumber);
          }
        } else {
          // Single select: replace selection
          return new Set([sceneNumber]);
        }
        return newSet;
      });
      setLastSelectedScene(sceneNumber);
    },
    [lastSelectedScene],
  );

  const clearSelection = useCallback(() => {
    setSelectedScenes(new Set());
    setLastSelectedScene(null);
  }, []);

  const startDrag = useCallback((sceneNumber: number) => {
    setDraggedSceneNumber(sceneNumber);
  }, []);

  const endDrag = useCallback(() => {
    setDraggedSceneNumber(null);
    setDropInsertIndex(null);
  }, []);

  const setDropIndex = useCallback((index: number | null) => {
    setDropInsertIndex(index);
  }, []);

  const reorderScenes = useCallback(
    async (
      draggedSceneNum: number,
      insertIndex: number,
      projectState: ProjectState | null,
      projectDirectory: string | null,
      onStateUpdate: (state: ProjectState) => void,
    ) => {
      if (
        !projectState ||
        !projectState.storyboard_outline ||
        !projectDirectory
      )
        return;

      const currentScenes = [...projectState.storyboard_outline.scenes];
      const draggedIndex = currentScenes.findIndex(
        (s) => s.scene_number === draggedSceneNum,
      );

      if (draggedIndex === -1) return;

      // If dragging to the same position, do nothing
      if (draggedIndex === insertIndex) return;

      // Remove dragged scene from its current position
      const [draggedScene] = currentScenes.splice(draggedIndex, 1);

      // Adjust insert index if dragging forward (since we removed an element)
      const adjustedInsertIndex =
        draggedIndex < insertIndex ? insertIndex - 1 : insertIndex;

      // Insert at target position
      currentScenes.splice(adjustedInsertIndex, 0, draggedScene);

      // Create mapping from old scene numbers to new positions
      const sceneNumberMap = new Map<number, number>();
      currentScenes.forEach((scene, newIndex) => {
        sceneNumberMap.set(scene.scene_number, newIndex + 1);
      });

      // Update scene numbers sequentially
      const reorderedScenes = currentScenes.map((scene, index) => ({
        ...scene,
        scene_number: index + 1,
      }));

      // Update artifacts' scene numbers using the mapping
      const updatedArtifacts = projectState.artifacts.map((artifact) => {
        if (!artifact.scene_number) return artifact;

        const newSceneNum = sceneNumberMap.get(artifact.scene_number);
        if (!newSceneNum) return artifact;

        return {
          ...artifact,
          scene_number: newSceneNum,
        };
      });

      // Update project state
      const updatedState: ProjectState = {
        ...projectState,
        storyboard_outline: {
          ...projectState.storyboard_outline,
          scenes: reorderedScenes,
          total_scenes: reorderedScenes.length,
        },
        artifacts: updatedArtifacts,
        updated_at: new Date().toISOString(),
      };

      // Save to file
      try {
        const stateFilePath = `${projectDirectory}/.dhee/project.json`;
        await window.electron.project.writeFile(
          stateFilePath,
          JSON.stringify(updatedState, null, 2),
        );
        onStateUpdate(updatedState);
      } catch {
        // Failed to save
      }
    },
    [],
  );

  const value: TimelineContextType = {
    selectedScenes,
    selectScene,
    clearSelection,
    draggedSceneNumber,
    dropInsertIndex,
    startDrag,
    endDrag,
    setDropIndex,
    reorderScenes,
  };

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

export function useTimeline(): TimelineContextType {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error('useTimeline must be used within TimelineProvider');
  }
  return context;
}
