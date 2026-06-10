/**
 * WorkspaceLayout — binary workspace.
 *
 * Per the 2026-05-28 architectural pivot, the app is exactly:
 *   - StatusStrip (top edge) — back, project name, run-status, overlay launchers
 *   - InspectorView (left, ~70%) — the bundle DAG canvas + agent regen
 *   - ChatPanelEmbedded (right, ~30%, collapsible) — pi-agent
 *   - OverlayHost (above all) — Settings / Library / Plans / Timeline as overlays
 *
 * Anything that used to be a permanent tab (Watch, Plans, Timeline,
 * Settings) is now invoked from the StatusStrip launchers OR from
 * canvas nodes (e.g. final_video → library overlay). One screen, no
 * tabs.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from 'react-resizable-panels';
import { InspectorView } from '../../../inspector/InspectorView';
import ChatPanel from '../../chat/ChatPanelEmbedded/ChatPanelEmbedded';
import StatusStrip from '../StatusStrip/StatusStrip';
import TransportBar from '../../run/TransportBar/TransportBar';
import { OverlayProvider } from '../../../overlays/OverlayContext';
import { OverlayHost } from '../../../overlays/OverlayHost';
import { TimelineDataProvider } from '../../../contexts/TimelineDataContext';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useProject } from '../../../contexts/ProjectContext';
import { useRunnerStatus } from '../../../hooks/useRunnerStatus';
import styles from './WorkspaceLayout.module.scss';

function getProjectDisplayName(
  projectName: string | null,
  projectDirectory: string | null,
): string | null {
  if (projectName?.trim()) return projectName.trim();
  if (!projectDirectory) return null;
  const folderName = projectDirectory.replace(/\\/g, '/').split('/').pop();
  if (!folderName) return null;
  return folderName.replace(/\.dhee$/i, '');
}

export default function WorkspaceLayout() {
  const { closeProject, projectName, projectDirectory } = useWorkspace();
  const { bundle } = useProject();
  const { active: runnerActive, cancel: cancelRunner } = useRunnerStatus();
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const displayProjectName = getProjectDisplayName(
    projectName,
    projectDirectory,
  );

  const handleBack = useCallback(async () => {
    if (runnerActive) {
      const ok = window.confirm(
        'A run is in progress on this project. Going back will cancel it. Continue?',
      );
      if (!ok) return;
      try {
        await cancelRunner();
      } catch {
        /* best-effort */
      }
    }
    closeProject();
  }, [runnerActive, cancelRunner, closeProject]);

  const toggleChat = useCallback(() => {
    const panel = chatPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, []);

  // Cmd+I to toggle chat — preserved from the old layout.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = /mac/i.test(navigator.userAgent);
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        toggleChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleChat]);

  return (
    <OverlayProvider>
     <TimelineDataProvider>
      <div className={styles.container}>
        <StatusStrip
          onBack={handleBack}
          projectName={displayProjectName ?? undefined}
          bundleId={bundle?.id}
        />
        <TransportBar />
        <div className={styles.workspace}>
          <PanelGroup direction="horizontal" autoSaveId="workspace-panels-v2">
            <Panel defaultSize={70} minSize={50}>
              <InspectorView />
            </Panel>
            <PanelResizeHandle className={styles.resizeHandle} />
            <Panel
              ref={chatPanelRef}
              defaultSize={30}
              minSize={20}
              maxSize={50}
              collapsible
              collapsedSize={0}
            >
              <div
                className={styles.panelTourTarget}
                data-tour-id="workspace-chat-panel"
              >
                <ChatPanel />
              </div>
            </Panel>
          </PanelGroup>
        </div>
        <OverlayHost />
      </div>
     </TimelineDataProvider>
    </OverlayProvider>
  );
}
