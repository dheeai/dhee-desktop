#!/usr/bin/env node
// Compatibility launcher only. Core owns the MCP server and protocol lifecycle.
import { configureProductionRuntime } from './control.js';

async function main() {
  configureProductionRuntime();
  const moduleName = 'dhee-core/mcp/stdio';
  const { startProductionStdio } = (await import(moduleName)) as {
    startProductionStdio: () => Promise<void>;
  };
  await startProductionStdio();
}
main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
