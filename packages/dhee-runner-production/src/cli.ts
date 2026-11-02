#!/usr/bin/env node
import { runControlCli } from './cliIo.js';
// This process owns stdout: reserve it for the response, including when
// discovered runners or engine helpers write progress directly.
const writeResult = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
const controller = new AbortController();
const stop = () => controller.abort(new Error('Stopped by operator'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
async function main() {
  const code = await runControlCli(
    process.argv.slice(2),
    {
      input: process.stdin,
      write: (text) => {
        writeResult(text);
      },
      log: (text) => {
        process.stderr.write(`${text}\n`);
      },
    },
    { signal: controller.signal },
  );
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  // The embedded engine may retain timers; drain the result before exiting.
  writeResult('', () => process.stderr.write('', () => process.exit(code)));
}
main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
