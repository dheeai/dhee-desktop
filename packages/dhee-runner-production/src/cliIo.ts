import { createReadStream } from 'node:fs';
import { Readable, addAbortSignal } from 'node:stream';
import {
  executeProductionRequest,
  type ProductionOptions,
  type ProductionResponse,
} from './control.js';

const MAX_BYTES = 1024 * 1024;
export async function runControlCli(
  args: string[],
  io: {
    input: AsyncIterable<string | Uint8Array>;
    write: (text: string) => void;
    log: (text: string) => void;
  },
  options: ProductionOptions = {},
  execute = executeProductionRequest,
): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    io.write(
      'dhee-desktop-control [--request request.json]\nReads one JSON request (stdin by default); emits one JSON response. Operations: gpu.catalog, gpu.jobs, gpu.targets, gpu.prepare, gpu.run, gpu.recovery.inspect, gpu.recovery.link, assembly.targets, assembly.run, media.check, project.status, review.enable, review.read, review.decide, project.run.\n',
    );
    return 0;
  }
  let response: ProductionResponse;
  try {
    if (
      args.length !== 0 &&
      !(
        args.length === 2 &&
        args[0] === '--request' &&
        args[1] &&
        !args[1].startsWith('--')
      )
    )
      throw new Error('Usage: dhee-desktop-control [--request request.json]');
    const source = args.length ? createReadStream(args[1]!) : io.input;
    if (options.signal && source instanceof Readable)
      addAbortSignal(options.signal, source);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of source) {
      options.signal?.throwIfAborted();
      const bytes =
        typeof chunk === 'string'
          ? Buffer.from(chunk)
          : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > MAX_BYTES)
        throw new Error(
          'Control requests are limited to 1 MiB; pass media paths instead of encoded files.',
        );
      chunks.push(bytes);
    }
    const request: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response = await execute(request, { ...options, log: io.log });
  } catch (error) {
    response = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  io.write(`${JSON.stringify(response)}\n`);
  return response.ok ? 0 : 1;
}
