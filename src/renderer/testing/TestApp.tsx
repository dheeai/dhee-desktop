/**
 * Test entry component. Used in place of <App /> when KSHANA_TEST_BRIDGE=1.
 *
 * Switches on `scenario.surface` (set via the test bridge):
 *
 * - `chat` (default) — `ChatPanelEmbedded` only inside a bare
 *   `WorkspaceProvider`, project auto-opened from the scenario. Used by
 *   the original chat-flow specs.
 * - `landing` — full `<App />` with NO project auto-opened, so the
 *   LandingScreen renders. Used by Landing + Settings tests that
 *   navigate from there.
 * - `workspace` — full `<App />` with the scenario's project
 *   auto-opened, so the WorkspaceLayout renders (Timeline, Assets,
 *   Storyboard, Preview, etc.).
 */
import { useEffect, useState } from 'react';
import {
  WorkspaceProvider,
  useWorkspace,
} from '../contexts/WorkspaceContext';
import { TimelineProvider } from '../contexts/TimelineContext';
import { ProjectProvider } from '../contexts/ProjectContext';
import { AgentProvider } from '../contexts/AgentContext';
import { AppSettingsProvider } from '../contexts/AppSettingsContext';
import LandingScreen from '../components/landing/LandingScreen/LandingScreen';
import WorkspaceLayout from '../components/layout/WorkspaceLayout/WorkspaceLayout';
import ErrorBoundary from '../components/ErrorBoundary';
import ChatPanelEmbedded from '../components/chat/ChatPanelEmbedded/ChatPanelEmbedded';
import ScenarioPicker from './ScenarioPicker';
import type { ScenarioSurface } from './installFakeBridge';
import '../styles/global.scss';

/** Polls the test bridge for a scenario project and calls openProject once it lands. */
function ProjectBootstrap({
  children,
  showPickerOnEmpty = true,
}: {
  children: React.ReactNode;
  showPickerOnEmpty?: boolean;
}) {
  const { openProject, projectDirectory } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [graceExpired, setGraceExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tryOpen = () => {
      const p = window.__kshanaTest?.getProject();
      if (!p?.directory || cancelled) return;
      openProject(p.directory).catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    };
    tryOpen();
    const interval = setInterval(() => {
      const p = window.__kshanaTest?.getProject();
      if (p?.directory) {
        tryOpen();
        clearInterval(interval);
      }
    }, 50);
    const stop = setTimeout(() => {
      clearInterval(interval);
      if (!cancelled) setGraceExpired(true);
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [openProject]);

  if (error) {
    return (
      <div style={{ padding: 16, color: '#f55' }}>
        TestApp openProject failed: {error}
      </div>
    );
  }
  if (!projectDirectory) {
    if (graceExpired && showPickerOnEmpty) {
      return <ScenarioPicker />;
    }
    return (
      <div
        data-testid="test-bridge-waiting"
        style={{ padding: 16, color: '#888' }}
      >
        Waiting for scenario…
      </div>
    );
  }
  return <>{children}</>;
}

/** Original chat-only mount — preserved for the existing 9 specs. */
function ChatSurface() {
  return (
    <WorkspaceProvider>
      <ProjectBootstrap>
        <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
          <ChatPanelEmbedded />
        </div>
      </ProjectBootstrap>
    </WorkspaceProvider>
  );
}

/** Full App content router — picks LandingScreen vs WorkspaceLayout. */
function AppContent() {
  const { projectDirectory } = useWorkspace();
  if (!projectDirectory) {
    return <LandingScreen />;
  }
  return <WorkspaceLayout />;
}

/**
 * Full app stack identical to `<App />` but optionally auto-opens the
 * scenario's project so workspace tests don't need to click through
 * the landing screen.
 */
function FullAppSurface({ autoOpen }: { autoOpen: boolean }) {
  return (
    <ErrorBoundary>
      <AppSettingsProvider>
        <WorkspaceProvider>
          <ProjectProvider>
            <TimelineProvider>
              <AgentProvider>
                {autoOpen ? (
                  <ProjectBootstrap showPickerOnEmpty={false}>
                    <AppContent />
                  </ProjectBootstrap>
                ) : (
                  <AppContent />
                )}
              </AgentProvider>
            </TimelineProvider>
          </ProjectProvider>
        </WorkspaceProvider>
      </AppSettingsProvider>
    </ErrorBoundary>
  );
}

export default function TestApp() {
  // Surface decision is made once on mount; tests pre-seed the scenario
  // via initScript so it's already loaded.
  const surface: ScenarioSurface =
    window.__kshanaTest?.getSurface() ?? 'chat';

  switch (surface) {
    case 'landing':
      return <FullAppSurface autoOpen={false} />;
    case 'workspace':
      return <FullAppSurface autoOpen />;
    case 'chat':
    default:
      return <ChatSurface />;
  }
}
