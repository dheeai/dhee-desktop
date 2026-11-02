#!/usr/bin/env node
import { Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createProductionMcpServer } from './mcp.js';

export async function startProductionStdio(
  execute?: Parameters<typeof createProductionMcpServer>[0],
) {
  // Engine/plugin console output must never be interpreted as JSON-RPC.
  const writeProtocol = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  const output = new Writable({
    write(chunk, encoding, callback) {
      writeProtocol(chunk, encoding, callback);
    },
  });
  const runtime = await createProductionMcpServer(execute);
  let stopping = false;
  async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    // Remains armed through stderr flushing, even if the consumer stopped reading.
    const deadline = setTimeout(() => process.exit(1), 21000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let exitCode = code;
    try {
      // SDK close aborts each request signal, including active GPU/media operations.
      await runtime.server.close();
      await Promise.race([
        runtime.drain(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'Shutdown timed out; inspect durable jobs before resuming.',
                ),
              ),
            20000,
          );
        }),
      ]);
    } catch (error) {
      exitCode = 1;
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
    } finally {
      clearTimeout(timer);
      process.stderr.write('', () => {
        clearTimeout(deadline);
        process.exit(exitCode);
      });
    }
  }
  // Both streams can emit the same EPIPE; the shutdown guard makes this idempotent.
  output.on('error', () => {
    shutdown().catch(() => process.exit(1));
  });
  process.stdout.on('error', () => {
    shutdown().catch(() => process.exit(1));
  });
  process.once('SIGINT', () => {
    shutdown().catch(() => process.exit(1));
  });
  process.once('SIGTERM', () => {
    shutdown().catch(() => process.exit(1));
  });
  process.stdin.once('end', () => {
    shutdown().catch(() => process.exit(1));
  });
  runtime.server.server.onclose = () => {
    shutdown().catch(() => process.exit(1));
  };
  runtime.server.server.onerror = (error) => {
    process.stderr.write(`${error.message}\n`);
  };
  runtime.server
    .connect(
      new StdioServerTransport(process.stdin, output, {
        maxBufferSize: 2 * 1024 * 1024,
      }),
    )
    .catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      return shutdown(1);
    });
}
if (require.main === module) {
  startProductionStdio().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
