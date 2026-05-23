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

/**
 * Poll the BackgroundTaskRunner status so the Back-to-Projects button
 * can guard against accidental cancellation of a long pipeline. 1.5s
 * matches ChatPanelEmbedded's poll cadence — a future cleanup could
 * lift this into a shared `useRunnerStatus` hook.
 */
const RUNNER_STATUS_POLL_MS = 1500;

export default function WorkspaceLayout() {
  const { closeProject, projectName, projectDirectory } = useWorkspace();
  const [chatExpanded, setChatExpanded] = useState(true);
  const [runnerActive, setRunnerActive] = useState(false);

  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const displayProjectName = getProjectDisplayName(
    projectName,
    projectDirectory,
  );

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await window.dhee.runnerStatus();
        if (!cancelled) setRunnerActive(!!status?.active);
      } catch {
        if (!cancelled) setRunnerActive(false);
      }
    };
    tick();
    const handle = setInterval(tick, RUNNER_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  const handleBack = useCallback(async () => {
    if (runnerActive) {
      // Soft confirm: explicit ack + an immediate cancel-and-exit
      // path. window.confirm is consistent with the rest of the
      // app's destructive-action prompts (file delete, etc.).
      const ok = window.confirm(
        'A run is in progress on this project. Going back will cancel it. Continue?',
      );
      if (!ok) return;
      try {
        await window.dhee.runnerCancel();
      } catch {
        /* best-effort — we still want to navigate even if the cancel RPC fails */
      }
    }
    closeProject();
  }, [runnerActive, closeProject]);

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
              runnerActive
                ? 'A run is in progress — clicking Back will cancel it'
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
