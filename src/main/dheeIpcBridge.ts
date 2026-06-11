/**
 * Typed IPC bridge between the renderer's `window.dhee.*` API and
 * the embedded `dheeCoreManager` in the main process.
 *
 * Each public method on `dheeCoreManager` gets a single
 * `ipcMain.handle(channel, …)` registration. Streaming events
 * (tool_call, agent_response, media_generated, …) all share one
 * channel — `dhee:event` — with a `{ eventName, sessionId, data }`
 * payload that mirrors the original WebSocket protocol so the
 * renderer's narrowing logic stays unchanged.
 *
 * No direct Electron imports outside of `ipcMain` and the BrowserWindow
 * type — the bridge is mostly plumbing and stays thin.
 */
import path from 'path';
import { ipcMain, type BrowserWindow } from 'electron';
import {
  dhee_CHANNELS,
  dhee_EVENT_CHANNEL,
  type dheeEvent,
  type dheeEventName,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type RunnerCancelResponse,
  type RunnerStatusResponse,
  type ConfigureProjectRequest,
  type OkResponse,
  type RunTaskRequest,
  type ChatPromptRequest,
  type ChatPromptResponse,
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
  type ResolveBundleRequest,
  type ResolveBundleResponse,
  type ResolveInstanceGraphRequest,
  type ResolveInstanceGraphResponse,
  type ListVersionsRequest,
  type ListVersionsResponse,
  type SelectVersionRequest,
  type WriteNodeContentRequest,
  type WriteNodeContentResponse,
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
  type ClearChatHistoryRequest,
  type ClearChatHistoryResponse,
  type GetHistoryRequest,
  type GetHistoryResponse,
} from '../shared/dheeIpc';
import { prefixAttachmentsToTask } from '../shared/attachmentTypes';
import type { dheeCoreManager, dheeCoreEvent } from './dheeCoreManager';

/**
 * Wire the bridge. Idempotent — if the channels are already registered
 * the previous handlers are replaced.
 *
 * `window` is needed so we can route streaming events to the right
 * renderer's webContents. In a multi-window future this would track
 * a window-id-keyed registry; for now there's exactly one Electron
 * BrowserWindow.
 */
export function registerdheeIpcBridge(
  manager: dheeCoreManager,
  window: BrowserWindow,
): void {
  // Re-register defensively (Electron throws if a channel is already
  // registered with the same name).
  for (const channel of Object.values(dhee_CHANNELS)) {
    try {
      ipcMain.removeHandler(channel);
    } catch { /* ignore — handler may not be registered yet */ }
  }

  ipcMain.handle(
    dhee_CHANNELS.CREATE_SESSION,
    (_event, req?: CreateSessionRequest): CreateSessionResponse => {
      const { id, resumed } = manager.createSession(req?.role, req?.resumeSessionId);
      const response: CreateSessionResponse = { sessionId: id, resumed };
      if (resumed) {
        const snapshot = manager.getSessionHistorySnapshot(id);
        if (snapshot && (snapshot.messages.length > 0 || snapshot.toolCalls.length > 0)) {
          response.history = snapshot as CreateSessionResponse['history'];
        }
      }
      return response;
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.CLEAR_CHAT_HISTORY,
    (_event, req: ClearChatHistoryRequest): ClearChatHistoryResponse => {
      const { newSessionId } = manager.clearChatHistory(req.sessionId, req.role);
      return { newSessionId, oldSessionId: req.sessionId };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.GET_HISTORY,
    (_event, req: GetHistoryRequest): GetHistoryResponse => {
      const snapshot = manager.getSessionHistorySnapshot(req.sessionId);
      const history =
        snapshot && (snapshot.messages.length > 0 || snapshot.toolCalls.length > 0)
          ? (snapshot as GetHistoryResponse['history'])
          : null;
      return { sessionId: req.sessionId, history };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.CONFIGURE_PROJECT,
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
    dhee_CHANNELS.RUN_TASK,
    async (_event, req: RunTaskRequest): Promise<OkResponse> => {
      const eventCb = (e: dheeCoreEvent) => publishEvent(window, e);
      // Attachment hints are prepended to the user's task here so
      // pi-agent's skill prompts (e.g. comfyui-workflow-integration)
      // see a one-line marker per attachment and call the right tool
      // without us having to extend dhee-core's runTask signature.
      const finalTask = prefixAttachmentsToTask(req.task, req.attachments);
      const result = await manager.runTask(
        req.sessionId,
        finalTask,
        req.stopAtStage ? { stopAtStage: req.stopAtStage } : {},
        eventCb,
      );
      return result.status === 'failed'
        ? { ok: false, ...(result.error ? { error: result.error } : {}) }
        : { ok: true };
    },
  );

  // Phase 6.5: chat-input messages route here (NOT through RUN_TASK).
  // RunTask still dispatches bundle runs via BackgroundTaskRunner;
  // ChatPrompt drives the per-session pi-agent.
  //
  // Phase 6.5c.b: events from pi-agent (text deltas, tool calls,
  // tool results) flow back during the turn via the same
  // 'dhee:event' channel runTask uses. The chat panel's existing
  // listeners pick them up for streaming text + inline media.
  ipcMain.handle(
    dhee_CHANNELS.CHAT_PROMPT,
    async (_event, req: ChatPromptRequest): Promise<ChatPromptResponse> => {
      const eventCb = (e: dheeCoreEvent) => publishEvent(window, e);
      // Attachment hints are prepended to the chat message here — the
      // SAME mechanism RUN_TASK uses — so pi-agent's skill prompts see a
      // one-line marker per attachment and call the right tool without
      // extending dhee-core's chatPrompt signature.
      const finalMessage = prefixAttachmentsToTask(req.message, req.attachments);
      return manager.chatPrompt(req.sessionId, finalMessage, eventCb);
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.SEND_RESPONSE,
    async (_event, req: SendResponseRequest): Promise<OkResponse> => {
      // sendUserResponse is a planned method on dheeCoreManager;
      // until it lands the bridge surfaces a clear "not yet" error
      // rather than crashing.
      const m = manager as unknown as { sendUserResponse?: (s: string, r: string, t?: string) => Promise<void> };
      if (typeof m.sendUserResponse !== 'function') {
        return { ok: false, error: 'sendUserResponse not yet implemented on dheeCoreManager' };
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
    dhee_CHANNELS.CANCEL_TASK,
    async (_event, req: CancelTaskRequest): Promise<CancelTaskResponse> => {
      const cancelled = await manager.cancelTask(req.sessionId);
      return { cancelled };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.RUNNER_CANCEL,
    async (): Promise<RunnerCancelResponse> => {
      return { cancelled: await manager.cancelBackgroundTask() };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.RUNNER_STATUS,
    async (): Promise<RunnerStatusResponse> => {
      return manager.getBackgroundTaskStatus();
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.REDO_NODE,
    async (_event, req: RedoNodeRequest): Promise<OkResponse> => {
      const result = await manager.redoNode(req.sessionId, req.nodeId, {
        ...(req.editedPrompt ? { editedPrompt: req.editedPrompt } : {}),
        ...(req.frame ? { frame: req.frame } : {}),
        ...(req.scope ? { scope: req.scope } : {}),
        ...(req.itemId ? { itemId: req.itemId } : {}),
        ...(req.projectDir ? { projectDir: req.projectDir } : {}),
      });
      return result.ok ? { ok: true } : { ok: false, ...(result.error ? { error: result.error } : {}) };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.FOCUS_PROJECT,
    async (_event, req: FocusProjectRequest): Promise<OkResponse> => {
      // The desktop sends the user-selected project's absolute path.
      // Pin dhee_PROJECTS_DIR to its parent so the embedded core's
      // filesystem helpers (and focusSessionProject's project.json
      // read) resolve to the same folder the user opened — not to
      // wherever the desktop was launched from. Backwards-compat:
      // older callers that omit projectDir leave the env untouched.
      if (req.projectDir) {
        process.env['dhee_PROJECTS_DIR'] = path.dirname(req.projectDir);
      }
      return manager.focusSessionProject(
        req.sessionId,
        req.projectName,
        req.projectDir,
      );
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.SET_AUTONOMOUS,
    (_event, req: SetAutonomousRequest): OkResponse => {
      manager.setAutonomousMode(req.sessionId, req.enabled);
      return { ok: true };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.SET_PI_OVERSIGHT,
    (_event, req: SetPiOversightRequest): OkResponse => {
      manager.setPiOversight(req.sessionId, req.enabled);
      return { ok: true };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.SET_VLM_JUDGE,
    (_event, req: SetVlmJudgeRequest): OkResponse => {
      manager.setVlmJudge(req.sessionId, req.enabled);
      return { ok: true };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.DELETE_SESSION,
    (_event, req: DeleteSessionRequest): OkResponse => {
      manager.deleteSession(req.sessionId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    dhee_CHANNELS.INVALIDATE_NODES,
    async (
      _event,
      req: InvalidateNodesRequest,
    ): Promise<InvalidateNodesResponse> => {
      try {
        const result = await manager.invalidateNodes(
          req.sessionId,
          req.nodeIds,
          req.source,
          req.projectDir,
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
    dhee_CHANNELS.LIST_WORKFLOWS,
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
    dhee_CHANNELS.GET_WORKFLOW,
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
    dhee_CHANNELS.UPDATE_WORKFLOW,
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
    dhee_CHANNELS.DELETE_WORKFLOW,
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
    dhee_CHANNELS.VALIDATE_WORKFLOW,
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

  // Resolve a bundleSource URI to its parsed bundle definition. The
  // renderer's PromptsView / AssetsView / etc. use this to discover
  // which nodes produce which capability — keeps the desktop bundle-
  // agnostic. See docs/display-capabilities.md in dhee-core.
  ipcMain.handle(
    dhee_CHANNELS.RESOLVE_BUNDLE,
    async (_event, req: ResolveBundleRequest): Promise<ResolveBundleResponse> => {
      try {
        // Dynamic ESM import — dhee-core/dag is ESM and can't be
        // require()'d, same pattern as the runners loader.
        const dagMod = (await import(
          /* webpackIgnore: true */ 'dhee-core/dag'
        )) as {
          parseBundleSource: (s: string) => { scheme: string; id: string };
          resolveBundleDir: (s: { scheme: string; id: string }) => string;
          loadBundle: (path: string) => unknown;
        };
        const source = dagMod.parseBundleSource(req.bundleSource);
        const bundleDir = dagMod.resolveBundleDir(source);
        // resolveBundleDir returns either a directory or a single-file
        // path. loadBundle handles both layouts.
        const bundlePath = bundleDir.endsWith('.json')
          ? bundleDir
          : path.join(bundleDir, 'bundle.json');
        const bundle = dagMod.loadBundle(bundlePath) as {
          id: string;
          version: string;
          description?: string;
          goal: string;
          nodes: Array<{
            id: string;
            kind: 'stage' | 'collection';
            displayName?: string;
            displayCapability?: string;
            headlineField?: string;
            itemSource?: string;
            itemKey?: string;
            outputs: { format: string; pattern: string };
            inputs?: Array<{ from: string }>;
          }>;
          display?: {
            thumbnail?: { from: string; pick?: 'first_completed' | 'random_completed' | 'latest_completed' };
            stats?: Array<{ label: string; source: string; count_completed?: boolean; path?: string }>;
          };
        };
        // Strip to fields the renderer needs. We ship `inputs[].from`
        // for edges (Inspector Canvas) and `headlineField` for tile
        // headlines; runner config + prompt templates stay in
        // dhee-core.
        return {
          ok: true,
          bundle: {
            id: bundle.id,
            version: bundle.version,
            ...(bundle.description ? { description: bundle.description } : {}),
            goal: bundle.goal,
            nodes: bundle.nodes.map((n) => ({
              id: n.id,
              kind: n.kind,
              ...(n.displayName ? { displayName: n.displayName } : {}),
              ...(n.displayCapability ? { displayCapability: n.displayCapability } : {}),
              ...(n.headlineField ? { headlineField: n.headlineField } : {}),
              // Fan-out metadata — lets the run cockpit compute a stable
              // expected total for collection stages (how many items the
              // source will produce) instead of the lazily-materialized
              // count. Bundle-agnostic: just itemSource + itemKey.
              ...(n.itemSource ? { itemSource: n.itemSource } : {}),
              ...(n.itemKey ? { itemKey: n.itemKey } : {}),
              outputs: { format: n.outputs.format, pattern: n.outputs.pattern },
              inputs: (n.inputs ?? []).map((i) => ({ from: i.from })),
            })),
            ...(bundle.display ? { display: bundle.display } : {}),
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ── RESOLVE_INSTANCE_GRAPH ───────────────────────────────────────────
  // Reads .dhee/events.jsonl from the project and folds it through
  // dhee-core's projectInstanceGraph. Lineage as a pure projection,
  // no bundle re-parsing or content sniffing on the renderer side.
  ipcMain.handle(
    dhee_CHANNELS.RESOLVE_INSTANCE_GRAPH,
    async (_event, req: ResolveInstanceGraphRequest): Promise<ResolveInstanceGraphResponse> => {
      try {
        const dagMod = (await import(
          /* webpackIgnore: true */ 'dhee-core/dag'
        )) as {
          openEventLog: (projectDir: string) => { read: (opts?: { branchId?: string; sinceSeq?: number }) => Iterable<unknown> };
          projectInstanceGraph: (
            events: Iterable<unknown>,
            opts?: { branchId?: string; asOfSeq?: number },
          ) => { instances: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
        };
        const log = dagMod.openEventLog(req.projectDir);
        const events = [...log.read()];
        const opts: { branchId?: string; asOfSeq?: number } = {};
        if (req.branchId) opts.branchId = req.branchId;
        if (typeof req.asOfSeq === 'number') opts.asOfSeq = req.asOfSeq;
        const graph = dagMod.projectInstanceGraph(events, opts);
        return {
          ok: true,
          graph: {
            instances: graph.instances as unknown as NonNullable<ResolveInstanceGraphResponse['graph']>['instances'],
            edges: graph.edges as unknown as NonNullable<ResolveInstanceGraphResponse['graph']>['edges'],
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ── LIST_VERSIONS ────────────────────────────────────────────────────
  // Folds .dhee/events.jsonl → the version tray for one instance via
  // dhee-core's listVersions. projectDir-native (like the graph).
  ipcMain.handle(
    dhee_CHANNELS.LIST_VERSIONS,
    async (_event, req: ListVersionsRequest): Promise<ListVersionsResponse> => {
      try {
        const dagMod = (await import(/* webpackIgnore: true */ 'dhee-core/dag')) as {
          openEventLog: (projectDir: string) => { read: (opts?: { branchId?: string }) => Iterable<unknown> };
          listVersions: (
            events: Iterable<unknown>,
            nodeId: string,
            itemId?: string,
            opts?: { branchId?: string },
          ) => Array<{ versionId: string; outputPath: string; selected: boolean; createdAt: number; generation?: { tool?: string } }>;
        };
        const log = dagMod.openEventLog(req.projectDir);
        const events = [...log.read()];
        const tray = dagMod.listVersions(
          events,
          req.nodeId,
          req.itemId,
          req.branchId ? { branchId: req.branchId } : {},
        );
        return {
          ok: true,
          versions: tray.map((v) => ({
            versionId: v.versionId,
            outputPath: v.outputPath,
            selected: v.selected,
            createdAt: v.createdAt,
            ...(v.generation?.tool ? { tool: v.generation.tool } : {}),
          })),
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ── SELECT_VERSION ───────────────────────────────────────────────────
  // Emits a version.selected event via the projection engine; the
  // canvas + downstream resolution pick up the chosen version.
  ipcMain.handle(
    dhee_CHANNELS.SELECT_VERSION,
    async (_event, req: SelectVersionRequest): Promise<OkResponse> => {
      try {
        const dagMod = (await import(/* webpackIgnore: true */ 'dhee-core/dag')) as {
          openProjectionEngine: (projectDir: string) => {
            appendAndProject: (input: {
              kind: string;
              actor: string;
              branchId: string;
              payload: Record<string, unknown>;
            }) => unknown;
          };
        };
        const eng = dagMod.openProjectionEngine(req.projectDir);
        eng.appendAndProject({
          kind: 'version.selected',
          actor: 'desktop',
          branchId: req.branchId ?? 'main',
          payload: {
            nodeId: req.nodeId,
            versionId: req.versionId,
            ...(req.itemId ? { itemId: req.itemId } : {}),
          },
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ── WRITE_NODE_CONTENT ───────────────────────────────────────────────
  // The Inspector modal's inline editor saves edited text here. Routes
  // through dhee-core's writeNodeContent — the SAME core the agent's
  // dhee_write_node_content tool uses — so the edit preserves the prior
  // version, marks the node user-completed, and cascades downstream
  // with per-instance precision (no sibling-shot wipe).
  ipcMain.handle(
    dhee_CHANNELS.WRITE_NODE_CONTENT,
    async (_event, req: WriteNodeContentRequest): Promise<WriteNodeContentResponse> => {
      try {
        const dagMod = (await import(/* webpackIgnore: true */ 'dhee-core/dag')) as unknown as {
          writeNodeContent: (input: {
            projectDir: string;
            nodeId: string;
            itemId?: string;
            content: Buffer;
            reason?: string;
            confirm?: boolean;
          }) =>
            | { ok: false; error: string }
            | { ok: true; status: 'preview'; preview: string }
            | { ok: true; status: 'written'; outputPath: string; invalidatedKeys: string[] };
        };
        const r = dagMod.writeNodeContent({
          projectDir: req.projectDir,
          nodeId: req.nodeId,
          content: Buffer.from(req.content, 'utf8'),
          ...(req.itemId !== undefined ? { itemId: req.itemId } : {}),
          ...(req.reason !== undefined ? { reason: req.reason } : {}),
          ...(req.confirm !== undefined ? { confirm: req.confirm } : {}),
        });
        if (!r.ok) return { ok: false, error: r.error };
        if (r.status === 'preview') return { ok: true, status: 'preview', preview: r.preview };
        return {
          ok: true,
          status: 'written',
          outputPath: r.outputPath,
          invalidatedKeys: r.invalidatedKeys,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}

/**
 * Re-publish a `dheeCoreEvent` from the manager onto the renderer's
 * single streaming channel. Defensive: if the eventName isn't a
 * known dheeEventName, drop the event with a console warning rather
 * than crashing the bridge.
 */
function publishEvent(window: BrowserWindow, event: dheeCoreEvent): void {
  if (!window) return;
  // isDestroyed may be absent on test mocks; guard defensively.
  if (typeof window.isDestroyed === 'function' && window.isDestroyed()) return;
  const knownEvents: ReadonlySet<string> = new Set<dheeEventName>([
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
    'session_status',
  ]);
  if (!knownEvents.has(event.eventName)) {
    // Don't crash the bridge on unrecognized event names — surface and drop.
    // eslint-disable-next-line no-console
    console.warn(`[dheeIpcBridge] unknown event '${event.eventName}' — dropping`);
    return;
  }
  const payload: dheeEvent = {
    eventName: event.eventName as dheeEventName,
    sessionId: event.sessionId,
    data: event.data,
  };
  window.webContents.send(dhee_EVENT_CHANNEL, payload);
}
