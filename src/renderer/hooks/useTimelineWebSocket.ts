import { useCallback, useEffect, useRef } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';

type TimelineMarkerStatus = 'pending' | 'processing' | 'complete' | 'error';

interface TimelineMarkerMessage {
  type: 'timeline_marker';
  marker_id: string;
  position: number;
  prompt: string;
  scene_context?: {
    current_scene?: number;
    previous_scenes?: Array<{ scene_number: number; description: string }>;
  };
}

interface TimelineMarkerResponse {
  type: 'timeline_marker_response';
  marker_id: string;
  status: TimelineMarkerStatus;
  artifact_id?: string;
  error?: string;
}

export function useTimelineWebSocket(
  onMarkerUpdate: (
    markerId: string,
    status: TimelineMarkerStatus,
    artifactId?: string,
  ) => void,
) {
  const { projectDirectory } = useWorkspace();
  const wsRef = useRef<WebSocket | null>(null);
  const connectingRef = useRef(false);

  const sendTimelineMarker = useCallback(
    async (message: Omit<TimelineMarkerMessage, 'type'>) => {
      if (!projectDirectory) {
        console.error('No project directory available');
        return;
      }

      try {
        // Get backend state to determine WebSocket URL
        const backendState = await window.electron.backend.getState();
        if (backendState.status !== 'ready') {
          console.error('Backend not ready');
          return;
        }

        // Connect WebSocket if not already connected
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          if (connectingRef.current) {
            // Wait for connection
            return;
          }

          connectingRef.current = true;
          const baseUrl = backendState.serverUrl || `http://localhost:${backendState.port || 8001}`;
          const wsUrl = new URL('/api/v1/ws/chat', baseUrl.replace(/^http/, 'ws'));
          const socket = new WebSocket(wsUrl.toString());

          await new Promise<void>((resolve, reject) => {
            socket.onopen = () => {
              wsRef.current = socket;
              connectingRef.current = false;
              resolve();
            };
            socket.onerror = (error) => {
              connectingRef.current = false;
              reject(error);
            };
            socket.onclose = () => {
              wsRef.current = null;
            };
          });
        }

        // Send timeline marker message
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          // Format as a message that includes timeline context
          const fullMessage = {
            message: `[TIMELINE_MARKER] At position ${message.position}s: ${message.prompt}`,
            timeline_marker: {
              marker_id: message.marker_id,
              position: message.position,
              prompt: message.prompt,
              scene_context: message.scene_context,
            },
          };
          wsRef.current.send(JSON.stringify(fullMessage));
        }
      } catch (error) {
        console.error('Failed to send timeline marker:', error);
      }
    },
    [projectDirectory],
  );

  // Set up WebSocket message listener
  useEffect(() => {
    if (!wsRef.current) return;

    const socket = wsRef.current;
    const handleMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);

        // Check for timeline marker response
        if (payload.type === 'timeline_marker_response') {
          const response = payload as TimelineMarkerResponse;
          onMarkerUpdate(
            response.marker_id,
            response.status,
            response.artifact_id,
          );
        }
        // Also check for artifact creation that might be related to timeline markers
        else if (payload.type === 'artifact_created' && payload.marker_id) {
          onMarkerUpdate(payload.marker_id, 'complete', payload.artifact_id);
        }
      } catch (error) {
        // Not a JSON message or not a timeline marker response
      }
    };

    socket.addEventListener('message', handleMessage);
    return () => {
      socket.removeEventListener('message', handleMessage);
    };
  }, [onMarkerUpdate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { sendTimelineMarker };
}
