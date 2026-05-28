import type { ReactNode } from 'react';
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext';
import { TimelineProvider } from './contexts/TimelineContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { AgentProvider } from './contexts/AgentContext';
import { AppSettingsProvider } from './contexts/AppSettingsContext';
import { ChatQuestionsProvider } from './contexts/ChatQuestionsContext';
import { FirstRunTourProvider } from './contexts/FirstRunTourContext';
import { DheeSessionProvider } from './hooks/useDheeSession';
import LandingScreen from './components/landing/LandingScreen/LandingScreen';
import WorkspaceLayout from './components/layout/WorkspaceLayout/WorkspaceLayout';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/global.scss';

function AppContent() {
  const { projectDirectory } = useWorkspace();

  if (!projectDirectory) {
    return <LandingScreen />;
  }

  return <WorkspaceLayout />;
}

function ScopedDheeSessionProvider({ children }: { children: ReactNode }) {
  const { projectDirectory, projectName } = useWorkspace();
  return (
    <DheeSessionProvider
      projectDirectory={projectDirectory}
      projectName={projectName}
    >
      {children}
    </DheeSessionProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppSettingsProvider>
        <WorkspaceProvider>
          <ScopedDheeSessionProvider>
            <FirstRunTourProvider>
              <ProjectProvider>
                <TimelineProvider>
                  <AgentProvider>
                    <ChatQuestionsProvider>
                      <AppContent />
                    </ChatQuestionsProvider>
                  </AgentProvider>
                </TimelineProvider>
              </ProjectProvider>
            </FirstRunTourProvider>
          </ScopedDheeSessionProvider>
        </WorkspaceProvider>
      </AppSettingsProvider>
    </ErrorBoundary>
  );
}
