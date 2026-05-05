/**
 * Kill any prior `pnpm start` / `npm start` instances of THIS project
 * before launching a fresh dev session. Stacking instances was making
 * it impossible to tell which Electron window had the latest renderer
 * bundle.
 *
 * Scoping rules — we only kill processes that satisfy ALL of:
 *   1. argv (full command line) contains this project's absolute root
 *   2. command path matches one of COMMAND_PATTERNS (electron,
 *      electronmon, webpack-dev-server)
 *   3. PID is not us, our parent (npm/pnpm), or our grandparent (the
 *      shell that invoked pnpm start)
 *
 * That keeps us from accidentally killing other electron apps the
 * user has open, and prevents self-suicide before the rest of the
 * `start` script chain runs.
 */
const { execSync } = require('node:child_process');
const { resolve } = require('node:path');
const chalk = require('chalk');

// .erb/scripts/ → project root is two up.
const projectRoot = resolve(__dirname, '..', '..');

/**
 * Path-scoped patterns. Match only when the process command line ALSO
 * contains the project root, so we don't kill unrelated dev sessions
 * for other Electron projects on the machine. The dev-script chain is
 * concurrently → cross-env → (webpack | electronmon) → electron, so
 * every wrapper level needs to be listed — otherwise stale wrappers
 * persist and re-spawn new Electron windows.
 */
const COMMAND_PATTERNS = [
  '/node_modules/electron/dist/Electron',
  '/node_modules/.bin/electronmon',
  '/node_modules/.bin/concurrently',
  '/node_modules/.bin/cross-env',
  '/node_modules/.bin/webpack',
  '/node_modules/webpack-dev-server/bin/webpack-dev-server',
];

/**
 * Title-only patterns. Some processes show up in `ps` with just an
 * application title and no path — most importantly the
 * electronmon-spawned Electron process (rendered as
 * "kshana-desktop - electronmon"). Path scoping is impossible for
 * these, but the title itself includes the package name so it's
 * specific enough to match unconditionally.
 */
const TITLE_PATTERNS = ['kshana-desktop - electronmon'];

/**
 * Pure predicate: does `command` (a process's full argv string) belong
 * to a stale kshana-desktop dev instance rooted at `projectRootArg`?
 *
 * Exported for unit testing — the runtime path-scoping is what makes
 * this script safe (we don't want to nuke unrelated electron apps).
 */
function isStaleCommand(command, projectRootArg) {
  if (!command) return false;
  // Unconditional title-based match: the title alone is unique
  // enough (contains the package name). Used for processes whose
  // command line ps renders without a path.
  if (TITLE_PATTERNS.some((pat) => command.includes(pat))) return true;
  // Path-scoped match for everything else.
  if (!projectRootArg) return false;
  if (!command.includes(projectRootArg)) return false;
  return COMMAND_PATTERNS.some((pat) => command.includes(pat));
}

/** Returns an array of { pid, command } for currently running processes. */
function listProcesses() {
  // -A: all processes; -ww: don't truncate the command. The columns
  // are: PID + everything else (the full command). We split off the
  // first whitespace-separated token to get the PID.
  const output = execSync('ps -Aww -o pid=,command=', { encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ');
      if (space === -1) return null;
      const pid = Number(line.slice(0, space).trim());
      const command = line.slice(space + 1).trim();
      if (!Number.isFinite(pid) || pid <= 0) return null;
      return { pid, command };
    })
    .filter((p) => p !== null);
}

function killGracefully(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function killForcefully(pid) {
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

function isAlive(pid) {
  try {
    // Signal 0 doesn't actually deliver a signal — it just probes
    // whether the PID exists and we have permission to signal it.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  const selfPid = process.pid;
  const parentPid = process.ppid;
  let grandparentPid = 0;
  try {
    grandparentPid = Number(
      execSync(`ps -o ppid= -p ${parentPid}`, { encoding: 'utf8' }).trim(),
    );
  } catch {
    /* ignore — best-effort */
  }
  const protectedPids = new Set(
    [selfPid, parentPid, grandparentPid].filter((pid) => pid > 0),
  );

  const procs = listProcesses();
  const stale = procs.filter(
    (p) =>
      !protectedPids.has(p.pid) && isStaleCommand(p.command, projectRoot),
  );

  if (stale.length === 0) return;

  console.log(
    chalk.yellow(
      `[kill-stale-instances] Found ${stale.length} stale kshana-desktop process(es):`,
    ),
  );
  for (const { pid, command } of stale) {
    const summary =
      command.length > 100 ? `${command.slice(0, 100)}…` : command;
    console.log(chalk.gray(`  pid=${pid} ${summary}`));
  }

  for (const { pid } of stale) killGracefully(pid);

  // Give them ~1.5s to exit cleanly. Webpack-dev-server, in particular,
  // releases the port asynchronously after SIGTERM.
  await sleep(1500);

  const stubborn = stale.filter(({ pid }) => isAlive(pid));
  if (stubborn.length > 0) {
    console.log(
      chalk.yellow(
        `[kill-stale-instances] Force-killing ${stubborn.length} stubborn process(es)…`,
      ),
    );
    for (const { pid } of stubborn) killForcefully(pid);
    await sleep(300);
  }

  console.log(chalk.green('[kill-stale-instances] Cleared.'));
}

module.exports = { isStaleCommand, COMMAND_PATTERNS, TITLE_PATTERNS };

// Run main() only when invoked directly (not when required by a test).
if (require.main === module) {
  main().catch((err) => {
    console.error(
      chalk.red('[kill-stale-instances] failed:'),
      err instanceof Error ? err.message : err,
    );
    // Non-fatal: if we can't list processes, just continue. The
    // downstream port check will catch the port-in-use case.
  });
}
