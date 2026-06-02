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
import { ShortcutsOverlay } from './shortcuts/ShortcutsOverlay';
import './styles/global.scss';

function AppContent() {
  const { projectDirectory } = useWorkspace();

  return (
    <>
      {projectDirectory ? <WorkspaceLayout /> : <LandingScreen />}
      {/* Cmd+/ shortcuts panel — invokable anywhere in the app */}
      <ShortcutsOverlay />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppSettingsProvider>
        <DheeSessionProvider>
          <WorkspaceProvider>
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
          </WorkspaceProvider>
        </DheeSessionProvider>
      </AppSettingsProvider>
    </ErrorBoundary>
  );
}
