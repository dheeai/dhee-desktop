export type CloudUsageKind =
  | 'llm'
  | 'image_generation'
  | 'image_edit'
  | 'video_generation';

export interface CloudUsageFact {
  eventId: string;
  kind: CloudUsageKind;
  toolName?: string;
  toolCallId?: string;
  facts: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    imageCount?: number;
    seconds?: number;
    artifactId?: string;
    filePath?: string;
  };
}

export interface BillableCloudUsage {
  eventKey: string;
  usageFact: CloudUsageFact;
}

export interface CloudBillingMessage {
  type: string;
  sessionId?: string | null;
  data?: unknown;
}

export interface CloudBillingState {
  llmUsageSequence: number;
  startedToolCalls: Map<
    string,
    {
      toolName?: string;
      toolCallId?: string;
      arguments?: unknown;
    }
  >;
}

export interface CloudJobBillingContext {
  id: string;
  baseUrl: string;
  token: string;
}

export function createCloudBillingState(): CloudBillingState {
  return {
    llmUsageSequence: 0,
    startedToolCalls: new Map(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function buildCloudUsageIdempotencyKey({
  cloudJobId,
  sessionId,
  eventKey,
}: {
  cloudJobId?: string | null;
  sessionId?: string | null;
  eventKey?: string | null;
}): string | null {
  const cleanCloudJobId = nonEmptyString(cloudJobId);
  const cleanSessionId = nonEmptyString(sessionId);
  const cleanEventKey = nonEmptyString(eventKey);
  if (!cleanCloudJobId || !cleanSessionId || !cleanEventKey) return null;
  return `${cleanCloudJobId}:${cleanSessionId}:${cleanEventKey}`;
}

function getToolCallStateKey(message: CloudBillingMessage): string | null {
  const sessionId = nonEmptyString(message.sessionId);
  const data = asRecord(message.data);
  const toolCallId = nonEmptyString(data.toolCallId);
  if (!sessionId || !toolCallId) return null;
  return `${sessionId}:${toolCallId}`;
}

function getArtifactFacts(result: unknown) {
  const resultRecord = asRecord(result);
  const artifactId =
    nonEmptyString(resultRecord.artifact_id) ??
    nonEmptyString(resultRecord.artifactId);
  const filePath =
    nonEmptyString(resultRecord.file_path) ??
    nonEmptyString(resultRecord.filePath);

  return {
    ...(artifactId ? { artifactId } : {}),
    ...(filePath ? { filePath } : {}),
  };
}

function getVideoSeconds(result: unknown, args: unknown): number | null {
  const resultRecord = asRecord(result);
  const params = asRecord(resultRecord.params);
  const argsRecord = asRecord(args);
  const duration =
    positiveNumber(params.duration) ??
    positiveNumber(params.seconds) ??
    positiveNumber(resultRecord.duration) ??
    positiveNumber(resultRecord.seconds) ??
    positiveNumber(argsRecord.duration) ??
    positiveNumber(argsRecord.seconds);
  return duration ? Math.ceil(duration) : null;
}

function isImageGenerationTool(toolName: string): boolean {
  return toolName === 'generate_image' || toolName === 'generate_shot_image';
}

function isImageEditTool(toolName: string): boolean {
  return toolName === 'edit_image';
}

function getImageUsageKind(
  toolName: string,
  args: unknown,
): 'image_generation' | 'image_edit' {
  if (isImageEditTool(toolName)) return 'image_edit';
  const argsRecord = asRecord(args);
  const mode =
    nonEmptyString(argsRecord.mode) ??
    nonEmptyString(argsRecord.generation_mode) ??
    nonEmptyString(argsRecord.generationMode);
  if (
    toolName === 'generate_shot_image' &&
    (mode === 'image_text_to_image' ||
      mode === 'image_to_image' ||
      mode === 'edit' ||
      Object.keys(argsRecord).some((key) => key.startsWith('ref_')))
  ) {
    return 'image_edit';
  }
  return 'image_generation';
}

function isVideoGenerationTool(toolName: string): boolean {
  return (
    toolName === 'generate_video_from_image' ||
    toolName === 'generate_video' ||
    toolName === 'generate_shot_video'
  );
}

function buildContextUsageFact(
  message: CloudBillingMessage,
  sequence: number,
): BillableCloudUsage | null {
  if (message.type !== 'context_usage') return null;
  const sessionId = nonEmptyString(message.sessionId);
  const data = asRecord(message.data);
  const promptTokens = positiveNumber(data.promptTokens);
  const completionTokens = positiveNumber(data.completionTokens);
  const reportedTotalTokens = positiveNumber(data.totalTokens);
  const usageSequence = positiveNumber(sequence);

  if (
    !sessionId ||
    !promptTokens ||
    !reportedTotalTokens ||
    !usageSequence
  ) {
    return null;
  }

  const totalTokens = Math.ceil(reportedTotalTokens);
  const eventKey = `context:${Math.ceil(usageSequence)}`;
  return {
    eventKey,
    usageFact: {
      eventId: eventKey,
      kind: 'llm',
      facts: {
        promptTokens: Math.ceil(promptTokens),
        ...(completionTokens
          ? { completionTokens: Math.ceil(completionTokens) }
          : {}),
        totalTokens,
      },
    },
  };
}

function buildToolUsageFact(
  message: CloudBillingMessage,
  state: CloudBillingState,
): BillableCloudUsage | null {
  if (message.type !== 'tool_call') return null;

  const data = asRecord(message.data);
  const toolStateKey = getToolCallStateKey(message);
  const startedToolCall = toolStateKey
    ? state.startedToolCalls.get(toolStateKey)
    : null;

  if (data.status === 'started' && toolStateKey) {
    state.startedToolCalls.set(toolStateKey, {
      toolName: nonEmptyString(data.toolName) ?? undefined,
      toolCallId: nonEmptyString(data.toolCallId) ?? undefined,
      arguments: data.arguments,
    });
    return null;
  }

  if (data.status === 'error' && toolStateKey) {
    state.startedToolCalls.delete(toolStateKey);
    return null;
  }

  if (data.status !== 'completed') return null;

  const toolName =
    nonEmptyString(data.toolName) ?? nonEmptyString(startedToolCall?.toolName);
  const toolCallId =
    nonEmptyString(data.toolCallId) ??
    nonEmptyString(startedToolCall?.toolCallId);

  if (toolStateKey) {
    state.startedToolCalls.delete(toolStateKey);
  }

  if (!toolName || !toolCallId) return null;

  const result = data.result;
  const artifactFacts = getArtifactFacts(result);

  if (isImageGenerationTool(toolName) || isImageEditTool(toolName)) {
    const kind = getImageUsageKind(toolName, startedToolCall?.arguments);
    const eventKey = `${toolCallId}:${toolName}:${kind}`;
    return {
      eventKey,
      usageFact: {
        eventId: eventKey,
        kind,
        toolName,
        toolCallId,
        facts: {
          imageCount: 1,
          ...artifactFacts,
        },
      },
    };
  }

  if (isVideoGenerationTool(toolName)) {
    const seconds = getVideoSeconds(result, startedToolCall?.arguments);
    if (!seconds) return null;

    const eventKey = `${toolCallId}:${toolName}:video_generation`;
    return {
      eventKey,
      usageFact: {
        eventId: eventKey,
        kind: 'video_generation',
        toolName,
        toolCallId,
        facts: {
          seconds,
          ...artifactFacts,
        },
      },
    };
  }

  return null;
}

export function deriveBillableCloudUsage(
  message: CloudBillingMessage,
  state: CloudBillingState,
): BillableCloudUsage | null {
  if (message.type === 'context_usage') {
    const nextSequence = state.llmUsageSequence + 1;
    const usage = buildContextUsageFact(message, nextSequence);
    if (usage) {
      state.llmUsageSequence = nextSequence;
    }
    return usage;
  }
  if (message.type === 'tool_call') {
    return buildToolUsageFact(message, state);
  }
  return null;
}

export function buildCloudUsageRequestBody(usage: BillableCloudUsage) {
  return {
    source: 'desktop-direct-core',
    usageFact: usage.usageFact,
  };
}

export async function postCloudUsage({
  cloudJob,
  sessionId,
  usage,
  fetchImpl = fetch,
}: {
  cloudJob: CloudJobBillingContext;
  sessionId: string;
  usage: BillableCloudUsage;
  fetchImpl?: typeof fetch;
}) {
  const idempotencyKey = buildCloudUsageIdempotencyKey({
    cloudJobId: cloudJob.id,
    sessionId,
    eventKey: usage.eventKey,
  });

  if (!idempotencyKey) {
    throw Object.assign(new Error('usage event missing idempotency inputs'), {
      status: 400,
      responseBody: { error: 'Invalid usage payload' },
    });
  }

  const response = await fetchImpl(
    `${cloudJob.baseUrl}/api/cloud/jobs/${encodeURIComponent(cloudJob.id)}/usage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cloudJob.token}`,
      },
      body: JSON.stringify({
        ...buildCloudUsageRequestBody(usage),
        idempotencyKey,
      }),
    },
  );

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(
        responseBody.message ||
          responseBody.error ||
          'Cloud usage billing failed',
      ),
      {
        status: response.status,
        responseBody,
      },
    );
  }

  return {
    ...responseBody,
    idempotencyKey,
  };
}
