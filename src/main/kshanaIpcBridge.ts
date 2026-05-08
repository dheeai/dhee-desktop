/**
 * Typed IPC bridge between the renderer's `window.kshana.*` API and
 * the embedded `KshanaCoreManager` in the main process.
 *
 * Each public method on `KshanaCoreManager` gets a single
 * `ipcMain.handle(channel, …)` registration. Streaming events
 * (tool_call, agent_response, media_generated, …) all share one
 * channel — `kshana:event` — with a `{ eventName, sessionId, data }`
 * payload that mirrors the original WebSocket protocol so the
 * renderer's narrowing logic stays unchanged.
 *
 * No direct Electron imports outside of `ipcMain` and the BrowserWindow
 * type — the bridge is mostly plumbing and stays thin.
 */
import path from 'path';
import { ipcMain, type BrowserWindow } from 'electron';
import {
  KSHANA_CHANNELS,
  KSHANA_EVENT_CHANNEL,
  type KshanaEvent,
  type KshanaEventName,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type RunnerCancelResponse,
  type RunnerStatusResponse,
  type ConfigureProjectRequest,
  type OkResponse,
  type RunTaskRequest,
  type SendResponseRequest,
  type CancelTaskRequest,
  type CancelTaskResponse,
  type RedoNodeRequest,
  type FocusProjectRequest,
  type SetAutonomousRequest,
  type SetPiOversightRequest,
  type SetVlmJudgeRequest,
  type DeleteSessionRequest,
  type InvalidateNodesRequest,
  type InvalidateNodesResponse,
  type ListWorkflowsRequest,
  type ListWorkflowsResponse,
  type GetWorkflowRequest,
  type GetWorkflowResponse,
  type UpdateWorkflowRequest,
  type UpdateWorkflowResponse,
  type DeleteWorkflowRequest,
  type DeleteWorkflowResponse,
  type ValidateWorkflowRequest,
  type ValidateWorkflowResponse,
} from '../shared/kshanaIpc';
import type { KshanaCoreManager, KshanaCoreEvent } from './kshanaCoreManager';

/**
 * Wire the bridge. Idempotent — if the channels are already registered
 * the previous handlers are replaced.
 *
 * `window` is needed so we can route streaming events to the right
 * renderer's webContents. In a multi-window future this would track
 * a window-id-keyed registry; for now there's exactly one Electron
 * BrowserWindow.
 */
export function registerKshanaIpcBridge(
  manager: KshanaCoreManager,
  window: BrowserWindow,
): void {
  // Re-register defensively (Electron throws if a channel is already
  // registered with the same name).
  for (const channel of Object.values(KSHANA_CHANNELS)) {
    try {
      ipcMain.removeHandler(channel);
    } catch { /* ignore — handler may not be registered yet */ }
  }

  ipcMain.handle(
    KSHANA_CHANNELS.CREATE_SESSION,
    (_event, req?: CreateSessionRequest): CreateSessionResponse => {
      const sessionId = manager.createSession(req?.role);
      return { sessionId };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.CONFIGURE_PROJECT,
    async (_event, req: ConfigureProjectRequest): Promise<OkResponse> => {
      try {
        await manager.configureSessionForProject(req.sessionId, {
          projectDir: req.projectDir,
          ...(req.templateId ? { templateId: req.templateId } : {}),
          ...(req.style ? { style: req.style } : {}),
          ...(req.duration !== undefined ? { duration: req.duration } : {}),
          ...(req.autonomousMode !== undefined ? { autonomousMode: req.autonomousMode } : {}),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.RUN_TASK,
    async (_event, req: RunTaskRequest): Promise<OkResponse> => {
      const eventCb = (e: KshanaCoreEvent) => publishEvent(window, e);
      const result = await manager.runTask(
        req.sessionId,
        req.task,
        req.stopAtStage ? { stopAtStage: req.stopAtStage } : {},
        eventCb,
      );
      return result.status === 'failed'
        ? { ok: false, ...(result.error ? { error: result.error } : {}) }
        : { ok: true };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.SEND_RESPONSE,
    async (_event, req: SendResponseRequest): Promise<OkResponse> => {
      // sendUserResponse is a planned method on KshanaCoreManager;
      // until it lands the bridge surfaces a clear "not yet" error
      // rather than crashing.
      const m = manager as unknown as { sendUserResponse?: (s: string, r: string, t?: string) => Promise<void> };
      if (typeof m.sendUserResponse !== 'function') {
        return { ok: false, error: 'sendUserResponse not yet implemented on KshanaCoreManager' };
      }
      try {
        await m.sendUserResponse(req.sessionId, req.response, req.toolCallId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.CANCEL_TASK,
    (_event, req: CancelTaskRequest): CancelTaskResponse => {
      const cancelled = manager.cancelTask(req.sessionId);
      return { cancelled };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.RUNNER_CANCEL,
    async (): Promise<RunnerCancelResponse> => {
      return { cancelled: await manager.cancelBackgroundTask() };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.RUNNER_STATUS,
    async (): Promise<RunnerStatusResponse> => {
      return manager.getBackgroundTaskStatus();
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.REDO_NODE,
    async (_event, req: RedoNodeRequest): Promise<OkResponse> => {
      const result = await manager.redoNode(req.sessionId, req.nodeId, {
        ...(req.editedPrompt ? { editedPrompt: req.editedPrompt } : {}),
        ...(req.frame ? { frame: req.frame } : {}),
        ...(req.scope ? { scope: req.scope } : {}),
      });
      return result.ok ? { ok: true } : { ok: false, ...(result.error ? { error: result.error } : {}) };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.FOCUS_PROJECT,
    async (_event, req: FocusProjectRequest): Promise<OkResponse> => {
      // The desktop sends the user-selected project's absolute path.
      // Pin KSHANA_PROJECTS_DIR to its parent so the embedded core's
      // filesystem helpers (and focusSessionProject's project.json
      // read) resolve to the same folder the user opened — not to
      // wherever the desktop was launched from. Backwards-compat:
      // older callers that omit projectDir leave the env untouched.
      if (req.projectDir) {
        process.env['KSHANA_PROJECTS_DIR'] = path.dirname(req.projectDir);
      }
      return manager.focusSessionProject(req.sessionId, req.projectName);
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.SET_AUTONOMOUS,
    (_event, req: SetAutonomousRequest): OkResponse => {
      manager.setAutonomousMode(req.sessionId, req.enabled);
      return { ok: true };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.SET_PI_OVERSIGHT,
    (_event, req: SetPiOversightRequest): OkResponse => {
      manager.setPiOversight(req.sessionId, req.enabled);
      return { ok: true };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.SET_VLM_JUDGE,
    (_event, req: SetVlmJudgeRequest): OkResponse => {
      manager.setVlmJudge(req.sessionId, req.enabled);
      return { ok: true };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.DELETE_SESSION,
    (_event, req: DeleteSessionRequest): OkResponse => {
      manager.deleteSession(req.sessionId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.INVALIDATE_NODES,
    async (
      _event,
      req: InvalidateNodesRequest,
    ): Promise<InvalidateNodesResponse> => {
      try {
        const result = await manager.invalidateNodes(
          req.sessionId,
          req.nodeIds,
        );
        return {
          ok: true,
          invalidated: result.invalidated,
          notFound: result.notFound,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // ── Custom ComfyUI workflow management ─────────────────────────────

  ipcMain.handle(
    KSHANA_CHANNELS.LIST_WORKFLOWS,
    (_event, req?: ListWorkflowsRequest): ListWorkflowsResponse => {
      try {
        const workflows = manager.listWorkflows({ userOnly: req?.userOnly });
        return { ok: true, workflows };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.GET_WORKFLOW,
    (_event, req: GetWorkflowRequest): GetWorkflowResponse => {
      try {
        const manifest = manager.getWorkflow(req.id);
        if (!manifest) return { ok: false, error: `Workflow '${req.id}' not found` };
        return { ok: true, manifest };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.UPDATE_WORKFLOW,
    (_event, req: UpdateWorkflowRequest): UpdateWorkflowResponse => {
      try {
        const manifest = manager.updateWorkflow(req.id, req.patch);
        return { ok: true, manifest };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.DELETE_WORKFLOW,
    (_event, req: DeleteWorkflowRequest): DeleteWorkflowResponse => {
      try {
        manager.deleteWorkflow(req.id);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    KSHANA_CHANNELS.VALIDATE_WORKFLOW,
    (_event, req: ValidateWorkflowRequest): ValidateWorkflowResponse => {
      try {
        const result = manager.validateWorkflow(req.path);
        if (!result.ok) {
          return { ok: true, valid: false, reason: result.reason };
        }
        return {
          ok: true,
          valid: true,
          totalNodes: result.totalNodes,
          detectedPipeline: result.detectedPipeline,
          inputNodeCount: result.inputNodeCount,
          loraCount: result.loraCount,
        };
      } catch (err) {
        return {
          ok: false,
          valid: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}

/**
 * Re-publish a `KshanaCoreEvent` from the manager onto the renderer's
 * single streaming channel. Defensive: if the eventName isn't a
 * known KshanaEventName, drop the event with a console warning rather
 * than crashing the bridge.
 */
function publishEvent(window: BrowserWindow, event: KshanaCoreEvent): void {
  if (!window) return;
  // isDestroyed may be absent on test mocks; guard defensively.
  if (typeof window.isDestroyed === 'function' && window.isDestroyed()) return;
  const knownEvents: ReadonlySet<string> = new Set<KshanaEventName>([
    'progress',
    'tool_call',
    'tool_result',
    'todo_updated',
    'agent_response',
    'agent_question',
    'status',
    'stream_chunk',
    'context_usage',
    'phase_transition',
    'timeline_update',
    'notification',
    'project_focused',
    'media_generated',
  ]);
  if (!knownEvents.has(event.eventName)) {
    // Don't crash the bridge on unrecognized event names — surface and drop.
    // eslint-disable-next-line no-console
    console.warn(`[kshanaIpcBridge] unknown event '${event.eventName}' — dropping`);
    return;
  }
  const payload: KshanaEvent = {
    eventName: event.eventName as KshanaEventName,
    sessionId: event.sessionId,
    data: event.data,
  };
  window.webContents.send(KSHANA_EVENT_CHANNEL, payload);
}
