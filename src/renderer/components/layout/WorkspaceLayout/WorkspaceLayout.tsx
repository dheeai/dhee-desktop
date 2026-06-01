import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from 'react-resizable-panels';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import PreviewPanel from '../../preview/PreviewPanel/PreviewPanel';
// Embedded mode (default since the main process now boots
// dhee-ink in-process). Legacy WS-backed ChatPanel stays in tree
// at ../../chat/ChatPanel/ChatPanel until a follow-up cleanup deletes
// it. To roll back, swap the line below to the old import.
import ChatPanel from '../../chat/ChatPanelEmbedded/ChatPanelEmbedded';
import StatusBar from '../StatusBar/StatusBar';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { useDheeSession } from '../../../hooks/useDheeSession';
import {
  normalizeRunnerProjectPath,
  runnerBelongsToProject,
} from '../../../utils/runnerProjectScope';
import styles from './WorkspaceLayout.module.scss';

function getProjectDisplayName(
  projectName: string | null,
  projectDirectory: string | null,
): string | null {
  if (projectName?.trim()) {
    return projectName.trim();
  }

  if (!projectDirectory) {
    return null;
  }

  const folderName = projectDirectory.replace(/\\/g, '/').split('/').pop();
  if (!folderName) {
    return null;
  }

  return folderName.replace(/\.dhee$/i, '');
}

export default function WorkspaceLayout() {
  const {
    closeProject,
    projectName,
    projectDirectory,
    registerProjectSwitchGuard,
  } = useWorkspace();
  const session = useDheeSession();
  const [chatExpanded, setChatExpanded] = useState(true);

  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const displayProjectName = getProjectDisplayName(
    projectName,
    projectDirectory,
  );
  const { execution } = session;

  const confirmAndCancelActiveWork = useCallback(async (): Promise<boolean> => {
    let ownsRunner = execution.runnerActive;
    try {
      const status = await window.dhee.runnerStatus();
      ownsRunner = runnerBelongsToProject(status, {
        projectDirectory,
        projectName,
      });
    } catch {
      // Keep the cached execution state if the just-in-time status
      // check fails. That avoids silently leaving an active run.
    }
    const hasActiveWork =
      ownsRunner || execution.chatBusy || execution.pendingCancel;
    if (!hasActiveWork) return true;

    // Soft confirm: explicit ack + an immediate cancel-and-exit path.
    // window.confirm is consistent with the rest of the app's
    // destructive-action prompts (file delete, etc.).
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      'Dhee is still working on this project. Going back will stop the current work. Continue?',
    );
    if (!ok) return false;
    await execution.cancel();
    return true;
  }, [execution, projectDirectory, projectName]);

  useEffect(() => {
    return registerProjectSwitchGuard(async (context) => {
      if (
        normalizeRunnerProjectPath(context.fromProjectDirectory) !==
        normalizeRunnerProjectPath(projectDirectory)
      ) {
        return true;
      }
      return confirmAndCancelActiveWork();
    });
  }, [
    confirmAndCancelActiveWork,
    projectDirectory,
    registerProjectSwitchGuard,
  ]);

  const handleBack = useCallback(async () => {
    if (!(await confirmAndCancelActiveWork())) return;
    closeProject();
  }, [closeProject, confirmAndCancelActiveWork]);

  const toggleChat = useCallback(() => {
    const panel = chatPanelRef.current;
    if (panel) {
      if (panel.isCollapsed()) {
        panel.expand();
      } else {
        panel.collapse();
      }
    }
  }, []);

  // Keyboard shortcut: Cmd+I for chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = /mac/i.test(navigator.userAgent);
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        toggleChat();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleChat]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            className={styles.backButton}
            onClick={handleBack}
            title={
              execution.active
                ? 'Dhee is still working — clicking Back will ask before stopping it'
                : 'Back to Landing'
            }
          >
            <ArrowLeft size={15} />
            <span>Back</span>
          </button>
        </div>
        <span
          className={styles.title}
          title={displayProjectName || 'Dhee Studio'}
        >
          {displayProjectName || 'Dhee Studio'}
        </span>
        <div className={styles.headerRight}>
          <button
            type="button"
            className={`${styles.toggleButton} ${chatExpanded ? styles.active : ''}`}
            onClick={toggleChat}
            title="Toggle Chat (⌘I)"
          >
            <MessageSquare size={16} />
          </button>
        </div>
      </div>

      <div className={styles.workspace}>
        <PanelGroup direction="horizontal" autoSaveId="workspace-panels">
          <Panel defaultSize={70} minSize={50}>
            <div
              className={styles.panelTourTarget}
              data-tour-id="workspace-preview"
            >
              <PreviewPanel />
            </div>
          </Panel>

          <PanelResizeHandle className={styles.resizeHandle} />
          <Panel
            ref={chatPanelRef}
            defaultSize={30}
            minSize={20}
            maxSize={50}
            collapsible
            collapsedSize={0}
            onCollapse={() => setChatExpanded(false)}
            onExpand={() => setChatExpanded(true)}
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

      <StatusBar />
    </div>
  );
}
