import { describe, expect, it, jest } from '@jest/globals';
import {
  buildCloudUsageIdempotencyKey,
  createCloudBillingState,
  deriveBillableCloudUsage,
  postCloudUsage,
} from './cloudDirectBilling';

describe('cloudDirectBilling', () => {
  it('derives LLM usage from context usage messages with local sequence keys', () => {
    const state = createCloudBillingState();

    const first = deriveBillableCloudUsage(
      {
        type: 'context_usage',
        sessionId: 'session_1',
        data: {
          promptTokens: 1234.2,
          completionTokens: 200.2,
          totalTokens: 1434.4,
          maxTokens: 8000,
          percentage: 15,
          wasCompressed: false,
          iteration: 99,
        },
      },
      state,
    );
    const second = deriveBillableCloudUsage(
      {
        type: 'context_usage',
        sessionId: 'session_1',
        data: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          iteration: 99,
        },
      },
      state,
    );

    expect(first).toEqual({
      eventKey: 'context:1',
      usageFact: {
        eventId: 'context:1',
        kind: 'llm',
        facts: {
          promptTokens: 1235,
          completionTokens: 201,
          totalTokens: 1435,
        },
      },
    });
    expect(second).toMatchObject({
      eventKey: 'context:2',
      usageFact: {
        eventId: 'context:2',
        kind: 'llm',
        facts: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        },
      },
    });
  });

  it('does not derive LLM usage when provider token usage is missing', () => {
    const state = createCloudBillingState();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'context_usage',
          sessionId: 'session_1',
          data: {
            promptTokens: 1234.2,
            maxTokens: 8000,
            percentage: 15,
            wasCompressed: false,
            iteration: 2,
          },
        },
        state,
      ),
    ).toBeNull();
  });

  it('derives image generation usage from completed tool calls', () => {
    const state = createCloudBillingState();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'completed',
            toolName: 'generate_image',
            toolCallId: 'tool_1',
            result: {
              artifact_id: 'artifact_1',
              file_path: 'images/one.png',
            },
          },
        },
        state,
      ),
    ).toEqual({
      eventKey: 'tool_1:generate_image:image_generation',
      usageFact: {
        eventId: 'tool_1:generate_image:image_generation',
        kind: 'image_generation',
        toolName: 'generate_image',
        toolCallId: 'tool_1',
        facts: {
          imageCount: 1,
          artifactId: 'artifact_1',
          filePath: 'images/one.png',
        },
      },
    });
  });

  it('derives image edit usage from completed tool calls', () => {
    const state = createCloudBillingState();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'completed',
            toolName: 'edit_image',
            toolCallId: 'tool_2',
            result: {
              artifactId: 'artifact_2',
              filePath: 'images/two.png',
            },
          },
        },
        state,
      )?.usageFact,
    ).toMatchObject({
      kind: 'image_edit',
      toolName: 'edit_image',
      facts: {
        imageCount: 1,
        artifactId: 'artifact_2',
        filePath: 'images/two.png',
      },
    });
  });

  it('derives shot image usage from completed media tool calls', () => {
    const state = createCloudBillingState();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'started',
            toolName: 'generate_shot_image',
            toolCallId: 'tool_7',
            arguments: { mode: 'text_to_image' },
          },
        },
        state,
      ),
    ).toBeNull();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'completed',
            toolName: 'generate_shot_image',
            toolCallId: 'tool_7',
            result: {
              artifact_id: 'artifact_7',
              file_path: 'images/shot.png',
            },
          },
        },
        state,
      ),
    ).toMatchObject({
      eventKey: 'tool_7:generate_shot_image:image_generation',
      usageFact: {
        kind: 'image_generation',
        toolName: 'generate_shot_image',
        facts: {
          imageCount: 1,
          artifactId: 'artifact_7',
          filePath: 'images/shot.png',
        },
      },
    });

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'started',
            toolName: 'generate_shot_image',
            toolCallId: 'tool_8',
            arguments: { mode: 'image_text_to_image' },
          },
        },
        state,
      ),
    ).toBeNull();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'completed',
            toolName: 'generate_shot_image',
            toolCallId: 'tool_8',
            result: {},
          },
        },
        state,
      ),
    ).toMatchObject({
      eventKey: 'tool_8:generate_shot_image:image_edit',
      usageFact: {
        kind: 'image_edit',
        toolName: 'generate_shot_image',
        facts: { imageCount: 1 },
      },
    });
  });

  it('derives video usage from completed tool result duration', () => {
    const state = createCloudBillingState();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'completed',
            toolName: 'generate_video_from_image',
            toolCallId: 'tool_3',
            result: {
              params: { duration: 3.2 },
              artifact_id: 'video_1',
            },
          },
        },
        state,
      )?.usageFact,
    ).toMatchObject({
      kind: 'video_generation',
      toolName: 'generate_video_from_image',
      facts: {
        seconds: 4,
        artifactId: 'video_1',
      },
    });
  });

  it('preserves started tool arguments for video duration fallback', () => {
    const state = createCloudBillingState();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'started',
            toolName: 'generate_video',
            toolCallId: 'tool_4',
            arguments: { duration: 5 },
          },
        },
        state,
      ),
    ).toBeNull();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'completed',
            toolName: 'generate_video',
            toolCallId: 'tool_4',
            result: { artifact_id: 'video_2' },
          },
        },
        state,
      )?.usageFact,
    ).toMatchObject({
      kind: 'video_generation',
      toolName: 'generate_video',
      facts: {
        seconds: 5,
        artifactId: 'video_2',
      },
    });
    expect(state.startedToolCalls.size).toBe(0);
  });

  it('derives shot video usage from started duration fallback', () => {
    const state = createCloudBillingState();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'started',
            toolName: 'generate_shot_video',
            toolCallId: 'tool_9',
            arguments: { duration: 5.4 },
          },
        },
        state,
      ),
    ).toBeNull();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'completed',
            toolName: 'generate_shot_video',
            toolCallId: 'tool_9',
            result: { file_path: 'videos/shot.mp4' },
          },
        },
        state,
      ),
    ).toMatchObject({
      eventKey: 'tool_9:generate_shot_video:video_generation',
      usageFact: {
        kind: 'video_generation',
        toolName: 'generate_shot_video',
        facts: {
          seconds: 6,
          filePath: 'videos/shot.mp4',
        },
      },
    });
    expect(state.startedToolCalls.size).toBe(0);
  });

  it('ignores failed tools and videos without duration', () => {
    const state = createCloudBillingState();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'error',
            toolName: 'generate_image',
            toolCallId: 'tool_5',
            error: 'failed',
          },
        },
        state,
      ),
    ).toBeNull();

    expect(
      deriveBillableCloudUsage(
        {
          type: 'tool_call',
          sessionId: 'session_1',
          data: {
            status: 'completed',
            toolName: 'generate_video_from_image',
            toolCallId: 'tool_6',
            result: {},
          },
        },
        state,
      ),
    ).toBeNull();
  });

  it('builds stable idempotency keys', () => {
    expect(
      buildCloudUsageIdempotencyKey({
        cloudJobId: 'job_1',
        sessionId: 'session_1',
        eventKey: 'tool_1:generate_image:image_generation',
      }),
    ).toBe('job_1:session_1:tool_1:generate_image:image_generation');
    expect(
      buildCloudUsageIdempotencyKey({
        cloudJobId: 'job_1',
        sessionId: '',
        eventKey: 'event',
      }),
    ).toBeNull();
  });

  it('posts usage to the website cloud job usage endpoint', async () => {
    const fetchImpl = jest.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ creditsUsed: 3 }),
        }) as Response,
    );

    const result = await postCloudUsage({
      cloudJob: {
        id: 'job_1',
        baseUrl: 'https://website.example',
        token: 'token_1',
      },
      sessionId: 'session_1',
      usage: {
        eventKey: 'tool_1:generate_image:image_generation',
        usageFact: {
          eventId: 'tool_1:generate_image:image_generation',
          kind: 'image_generation',
          toolName: 'generate_image',
          toolCallId: 'tool_1',
          facts: { imageCount: 1 },
        },
      },
      fetchImpl,
    });

    expect(result).toMatchObject({
      creditsUsed: 3,
      idempotencyKey: 'job_1:session_1:tool_1:generate_image:image_generation',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://website.example/api/cloud/jobs/job_1/usage',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_1',
        },
      }),
    );
    const requestInit = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      idempotencyKey: 'job_1:session_1:tool_1:generate_image:image_generation',
      source: 'desktop-direct-core',
      usageFact: {
        eventId: 'tool_1:generate_image:image_generation',
        kind: 'image_generation',
        toolName: 'generate_image',
        toolCallId: 'tool_1',
        facts: { imageCount: 1 },
      },
    });
  });

  it('throws response details when usage billing is rejected', async () => {
    const fetchImpl = jest.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ) =>
        ({
          ok: false,
          status: 402,
          json: async () => ({
            error: 'Insufficient credits',
            message: 'Credits exhausted',
          }),
        }) as Response,
    );

    await expect(
      postCloudUsage({
        cloudJob: {
          id: 'job_1',
          baseUrl: 'https://website.example',
          token: 'token_1',
        },
        sessionId: 'session_1',
        usage: {
          eventKey: 'tool_1:generate_image:image_generation',
          usageFact: {
            eventId: 'tool_1:generate_image:image_generation',
            kind: 'image_generation',
            facts: { imageCount: 1 },
          },
        },
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 402,
      message: 'Credits exhausted',
      responseBody: {
        error: 'Insufficient credits',
        message: 'Credits exhausted',
      },
    });
  });
});
