import type { ReactNode } from 'react';
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext';
import { TimelineProvider } from './contexts/TimelineContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { AgentProvider } from './contexts/AgentContext';
import { AppSettingsProvider } from './contexts/AppSettingsContext';
import { ChatQuestionsProvider } from './contexts/ChatQuestionsContext';
import { FirstRunTourProvider } from './contexts/FirstRunTourContext';
import { FirstRunSetupProvider, useFirstRunSetup } from './contexts/FirstRunSetupContext';
import { DheeSessionProvider } from './hooks/useDheeSession';
import LandingScreen from './components/landing/LandingScreen/LandingScreen';
import WorkspaceLayout from './components/layout/WorkspaceLayout/WorkspaceLayout';
import FirstRunSetup from './components/FirstRunSetup/FirstRunSetup';
import ErrorBoundary from './components/ErrorBoundary';
import { ShortcutsOverlay } from './shortcuts/ShortcutsOverlay';
import './styles/global.scss';

function AppContent() {
  const { projectDirectory } = useWorkspace();
  const { isActive: setupActive, ready: setupReady } = useFirstRunSetup();

  // On a fresh install, the full-screen setup flow takes over until the
  // user finishes/skips (which marks onboarding complete).
  if (setupReady && setupActive) {
    return <FirstRunSetup />;
  }

  return (
    <>
      {projectDirectory ? <WorkspaceLayout /> : <LandingScreen />}
      {/* Cmd+/ shortcuts panel — invokable anywhere in the app */}
      <ShortcutsOverlay />
    </>
  );
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
              <FirstRunSetupProvider>
                <ProjectProvider>
                  <TimelineProvider>
                    <AgentProvider>
                      <ChatQuestionsProvider>
                        <AppContent />
                      </ChatQuestionsProvider>
                    </AgentProvider>
                  </TimelineProvider>
                </ProjectProvider>
              </FirstRunSetupProvider>
            </FirstRunTourProvider>
          </ScopedDheeSessionProvider>
        </WorkspaceProvider>
      </AppSettingsProvider>
    </ErrorBoundary>
  );
}
