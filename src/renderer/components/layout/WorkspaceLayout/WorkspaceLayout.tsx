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
// kshana-ink in-process). Legacy WS-backed ChatPanel stays in tree
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

  return folderName.replace(/\.kshana$/i, '');
}

export default function WorkspaceLayout() {
  const { closeProject, projectName, projectDirectory } = useWorkspace();
  const [chatExpanded, setChatExpanded] = useState(true);

  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const displayProjectName = getProjectDisplayName(projectName, projectDirectory);

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
            onClick={closeProject}
            title="Back to Landing"
          >
            <ArrowLeft size={15} />
            <span>Back</span>
          </button>
        </div>
        <span className={styles.title} title={displayProjectName || 'Kshana Desktop'}>
          {displayProjectName || 'Kshana Desktop'}
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
            <PreviewPanel />
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
            <ChatPanel />
          </Panel>
        </PanelGroup>
      </div>

      <StatusBar />
    </div>
  );
}
