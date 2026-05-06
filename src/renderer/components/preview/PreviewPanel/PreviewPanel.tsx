import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ChevronUp, FolderKanban, Clapperboard, FileCode2, FileText, Layers } from 'lucide-react';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useProject } from '../../../contexts/ProjectContext';
import { TimelineDataProvider } from '../../../contexts/TimelineDataContext';
import type { SceneVersions } from '../../../types/kshana/timeline';
import AssetsView from '../AssetsView/AssetsView';
import StoryboardView from '../StoryboardView/StoryboardView';
import PromptsView from '../PromptsView/PromptsView';
import VideoLibraryView from '../VideoLibraryView/VideoLibraryView';
import PlansView from '../PlansView/PlansView';
import TimelinePanel from '../TimelinePanel/TimelinePanel';
import { TimelineDockIcon } from '../EditorIcons';
import styles from './PreviewPanel.module.scss';

type Tab = 'storyboard' | 'prompts' | 'assets' | 'video-library' | 'preview';

export default function PreviewPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('video-library');
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [timelineHeight, setTimelineHeight] = useState(320);

  // Shared playback state for timeline and video preview synchronization
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [, setTotalDuration] = useState(0);

  const { projectDirectory, pendingFileNavigation, clearFileNavigation } =
    useWorkspace();

  const tabs = useMemo(
    () => [
      {
        id: 'video-library' as const,
        label: 'Library',
        icon: Clapperboard,
      },
      {
        id: 'storyboard' as const,
        label: 'Storyboard',
        icon: Layers,
      },
      {
        id: 'prompts' as const,
        label: 'Prompts',
        icon: FileText,
      },
      {
        id: 'assets' as const,
        label: 'Assets',
        icon: FolderKanban,
      },
      {
        id: 'preview' as const,
        label: 'Files',
        icon: FileCode2,
      },
    ],
    [],
  );
  // Handle file navigation from chat panel
  useEffect(() => {
    if (pendingFileNavigation) {
      setActiveTab('preview');
    }
  }, [pendingFileNavigation]);

  useEffect(() => {
    if (projectDirectory) {
      setTimelineOpen(true);
    }
  }, [projectDirectory]);
  const { timelineState, scenes: projectScenes } = useProject();

  // Initialize activeVersions from timelineState with migration support
  const [activeVersions, setActiveVersions] = useState<
    Record<number, SceneVersions>
  >(() => {
    const versions: Record<number, SceneVersions> = {};
    if (timelineState?.active_versions) {
      Object.entries(timelineState.active_versions).forEach(
        ([folder, versionData]) => {
          // Extract scene number from folder name (e.g., "scene-001" -> 1)
          const match = folder.match(/scene-(\d+)/);
          if (match) {
            const sceneNumber = parseInt(match[1], 10);

            // Handle migration from old format (number) to new format (SceneVersions)
            if (typeof versionData === 'number') {
              // Old format: treat as video version
              versions[sceneNumber] = { video: versionData };
            } else if (versionData && typeof versionData === 'object') {
              // New format: use as-is
              versions[sceneNumber] = versionData;
            }
          }
        },
      );
    }
    return versions;
  });

  // Update activeVersions when timelineState changes (with migration)
  // Use ref to track previous serialized state to avoid infinite loops
  const prevActiveVersionsRef = useRef<string>('');

  useEffect(() => {
    if (!timelineState?.active_versions) {
      prevActiveVersionsRef.current = '';
      return;
    }

    const versions: Record<number, SceneVersions> = {};
    Object.entries(timelineState.active_versions).forEach(
      ([folder, versionData]) => {
        const match = folder.match(/scene-(\d+)/);
        if (match) {
          const sceneNumber = parseInt(match[1], 10);

          // Handle migration from old format (number) to new format (SceneVersions)
          if (typeof versionData === 'number') {
            versions[sceneNumber] = { video: versionData };
          } else if (versionData && typeof versionData === 'object') {
            versions[sceneNumber] = versionData;
          }
        }
      },
    );

    // Serialize to compare if content actually changed
    const serializedVersions = JSON.stringify(versions);

    // Only update if content actually changed
    if (serializedVersions !== prevActiveVersionsRef.current) {
      prevActiveVersionsRef.current = serializedVersions;
      setActiveVersions(versions);
    }
  }, [timelineState?.active_versions]);

  // Handle timeline resize
  const handleTimelineResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = timelineHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = startY - moveEvent.clientY; // Inverted because we're dragging up
        const newHeight = Math.max(200, Math.min(600, startHeight + deltaY));
        setTimelineHeight(newHeight);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [timelineHeight],
  );

  const shouldHydrateTimeline = activeTab === 'video-library' || timelineOpen;

  const renderActiveContent = () => (
    <div className={styles.content}>
      {activeTab === 'storyboard' && <StoryboardView />}
      {activeTab === 'prompts' && <PromptsView />}
      {activeTab === 'assets' && <AssetsView />}
      {activeTab === 'video-library' && (
        <VideoLibraryView
          playbackTime={playbackTime}
          isPlaying={isPlaying}
          isDragging={isDragging}
          onPlaybackTimeChange={setPlaybackTime}
          onPlaybackStateChange={setIsPlaying}
          onTotalDurationChange={setTotalDuration}
          activeVersions={activeVersions}
          projectScenes={projectScenes}
        />
      )}
      {activeTab === 'preview' && (
        <PlansView
          fileToOpen={pendingFileNavigation}
          onFileOpened={clearFileNavigation}
        />
      )}
    </div>
  );

  const renderTimelineSection = () => {
    if (!projectDirectory) {
      return null;
    }

    if (!timelineOpen) {
      return (
        <div className={`${styles.timelineContainer} ${styles.timelineDock}`}>
          <button
            type="button"
            className={styles.timelineCollapsedButton}
            onClick={() => setTimelineOpen(true)}
            title="Show Timeline"
          >
            <span className={styles.timelineCollapsedMeta}>
              <TimelineDockIcon size={16} />
              <span className={styles.timelineCollapsedLabel}>
                Timeline hidden
              </span>
            </span>
            <span className={styles.timelineCollapsedHint}>
              Open editor dock
              <ChevronUp size={16} />
            </span>
          </button>
        </div>
      );
    }

    return (
      <div
        className={styles.timelineContainer}
        style={{ height: `${timelineHeight}px` }}
      >
        <TimelinePanel
          isOpen={timelineOpen}
          onToggle={() => setTimelineOpen(!timelineOpen)}
          onResize={handleTimelineResize}
          playbackTime={playbackTime}
          isPlaying={isPlaying}
          onSeek={setPlaybackTime}
          onPlayPause={setIsPlaying}
          onDragStateChange={setIsDragging}
          activeVersions={activeVersions}
          onActiveVersionsChange={setActiveVersions}
        />
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Workspace views"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`${styles.tab} ${activeTab === id ? styles.active : ''}`}
                onClick={() => setActiveTab(id)}
                role="tab"
                aria-selected={activeTab === id}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.contentWrapper}>
        {shouldHydrateTimeline ? (
          <TimelineDataProvider activeVersions={activeVersions}>
            {renderActiveContent()}
            {renderTimelineSection()}
          </TimelineDataProvider>
        ) : (
          <>
            {renderActiveContent()}
            {renderTimelineSection()}
          </>
        )}
      </div>
    </div>
  );
}
