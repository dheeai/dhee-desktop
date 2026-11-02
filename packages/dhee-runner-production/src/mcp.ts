import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import {
  executeProductionRequest,
  type ProductionOptions,
  type ProductionResponse,
} from './control.js';

export const productionActions = [
  'scene.check',
  'gpu.catalog',
  'gpu.jobs',
  'gpu.targets',
  'gpu.prepare',
  'gpu.run',
  'gpu.recovery.inspect',
  'gpu.recovery.link',
  'assembly.targets',
  'assembly.run',
  'media.check',
  'project.status',
  'review.enable',
  'review.read',
  'review.decide',
  'project.run',
] as const;
type Execute = (
  request: unknown,
  options?: ProductionOptions,
) => Promise<ProductionResponse>;

/** Protocol adapter only: all state and execution stay in the shared controller. */
export async function createProductionMcpServer(
  execute: Execute = executeProductionRequest,
  log: (message: string) => void = (message) => {
    process.stderr.write(`${message}\n`);
  },
) {
  // Discover the public engine contract rather than maintaining a second schema.
  const moduleName = 'dhee-core/control';
  const { productionRequestSchema } = (await import(moduleName)) as {
    productionRequestSchema: z.ZodType;
  };
  const server = new McpServer(
    { name: 'dhee-desktop-production', version: '0.1.0' },
    { maxToolInputElements: 10000 },
  );
  const active = new Set<Promise<ProductionResponse>>();
  server.registerTool(
    'dhee_production_control',
    {
      title: 'Dhee Desktop production control',
      description:
        'Use Desktop production operations for project status, GPU catalog/preparation/exact runs/jobs/recovery, scene checks, media checks, assembly and reviews. Uses the same controller as Desktop and CLI. Read review previews before asking the user for approval; never set humanAcknowledged without the actual human decision. A successful response may pause at gatedAfter or budgetExceeded; it does not establish a finished or approved video. Requires absolute local project paths and configured versioned attempts. No raw GPU-submit operation.',
      inputSchema: {
        request: productionRequestSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ request }, extra) => {
      let response: ProductionResponse;
      try {
        if (Buffer.byteLength(JSON.stringify(request), 'utf8') > 1024 * 1024)
          throw new Error(
            'Control requests are limited to 1 MiB; pass media paths instead of encoded files.',
          );
        extra.signal.throwIfAborted();
        const pending = Promise.resolve().then(() =>
          execute(request, { signal: extra.signal, log }),
        );
        active.add(pending);
        try {
          response = await pending;
        } finally {
          active.delete(pending);
        }
      } catch (error) {
        response = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const nestedFailure =
        response.ok &&
        response.result !== null &&
        typeof response.result === 'object' &&
        'ok' in response.result &&
        response.result.ok === false;
      return {
        isError: !response.ok || nestedFailure,
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
        structuredContent: { ...response },
      };
    },
  );
  return { server, drain: () => Promise.allSettled([...active]) };
}
