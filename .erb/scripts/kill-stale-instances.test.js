/* eslint-disable no-restricted-syntax */
const { describe, expect, it } = require('@jest/globals');
const { isStaleCommand, COMMAND_PATTERNS } = require('./kill-stale-instances');

const PROJECT_ROOT = '/Users/ganaraj/Projects/kshana-desktop';

describe('isStaleCommand', () => {
  it('returns false when command is empty or undefined', () => {
    expect(isStaleCommand('', PROJECT_ROOT)).toBe(false);
    expect(isStaleCommand(undefined, PROJECT_ROOT)).toBe(false);
  });

  it('returns false when projectRoot is empty (refuses to match without scope)', () => {
    // Defensive — without a project root we'd match any electron
    // process anywhere on the machine.
    const electron = `${PROJECT_ROOT}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;
    expect(isStaleCommand(electron, '')).toBe(false);
    expect(isStaleCommand(electron, undefined)).toBe(false);
  });

  it('matches an electron process whose argv contains the project root', () => {
    const cmd = `${PROJECT_ROOT}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --require /some/preload.js`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(true);
  });

  it('matches an electronmon process for this project', () => {
    const cmd = `node ${PROJECT_ROOT}/node_modules/.bin/electronmon . --`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(true);
  });

  it('matches a webpack-dev-server process for this project', () => {
    const cmd = `node ${PROJECT_ROOT}/node_modules/webpack-dev-server/bin/webpack-dev-server.js --config ./.erb/configs/webpack.config.renderer.dev.ts`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(true);
  });

  it('matches a webpack CLI process for this project', () => {
    const cmd = `node ${PROJECT_ROOT}/node_modules/.bin/webpack --watch --config ./.erb/configs/webpack.config.main.dev.ts`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(true);
  });

  // ── Wrapper / orchestrator processes ────────────────────────────
  // The dev script chains concurrently → cross-env → webpack /
  // electronmon → electron. Earlier patterns only matched the leaf
  // electron + webpack-cli, so the wrappers piled up across launches
  // and re-spawned new Electron windows. Real-world ps lines from
  // an actual stale tree:

  it('matches the concurrently orchestrator that spawns webpack + electronmon', () => {
    const cmd = `node ${PROJECT_ROOT}/node_modules/.bin/concurrently -k -P cross-env NODE_ENV=development TS_NODE_TRANSPILE_ONLY=true webpack --watch --config ./.erb/configs/webpack.config.main.dev.ts electronmon . -- {@} --`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(true);
  });

  it('matches a cross-env wrapper running webpack for this project', () => {
    const cmd = `node ${PROJECT_ROOT}/node_modules/.bin/cross-env NODE_ENV=development TS_NODE_TRANSPILE_ONLY=true NODE_OPTIONS=-r ts-node/register --no-warnings webpack --config ./.erb/configs/webpack.config.preload.dev.ts`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(true);
  });

  it('matches a cross-env wrapper running webpack serve (renderer dev server)', () => {
    const cmd = `node ${PROJECT_ROOT}/node_modules/.bin/cross-env NODE_ENV=development TS_NODE_TRANSPILE_ONLY=true NODE_OPTIONS=-r ts-node/register --no-warnings webpack serve --config ./.erb/configs/webpack.config.renderer.dev.ts`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(true);
  });

  it('matches the electronmon-spawned electron process by its ps title even without a path', () => {
    // ps -o command= renders this electron process as just
    // "kshana-desktop - electronmon" — no path. But the title is
    // unique to this app's dev runs (it's a concat of the package
    // name and the command), so we match it unconditionally.
    const cmd = 'kshana-desktop - electronmon  ';
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(true);
    // Path scoping is irrelevant for the title-only match.
    expect(isStaleCommand(cmd, '/some/other/path')).toBe(true);
  });

  it('does NOT match a concurrently process from a different project', () => {
    const cmd = '/Users/me/other-project/node_modules/.bin/concurrently a b';
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(false);
  });

  it('does NOT match a cross-env process from a different project', () => {
    const cmd =
      '/Users/me/other-project/node_modules/.bin/cross-env FOO=1 some-cmd';
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(false);
  });

  it('does NOT match an electron process from a different project', () => {
    // Critical safety check — running `pnpm start` in kshana-desktop
    // must not nuke an unrelated Electron app.
    const otherProject = '/Users/ganaraj/Projects/some-other-electron-app';
    const cmd = `${otherProject}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(false);
  });

  it('does NOT match the installed Kshana.app from /Applications', () => {
    // Packaged app installs land under /Applications and don't
    // include the dev project path. Those should remain untouched.
    const cmd = '/Applications/Kshana.app/Contents/MacOS/Kshana --some-flag';
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(false);
  });

  it('does NOT match unrelated processes that happen to mention the project root', () => {
    // The path is mentioned (e.g. a tail on a log file or a code
    // editor), but the command isn't an electron/webpack-dev-server
    // pattern. Leave it alone.
    const cmd = `tail -f ${PROJECT_ROOT}/logs/debug.log`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(false);
  });

  it('does NOT match a generic node process inside the project (e.g. tsc, jest)', () => {
    const cmd = `${PROJECT_ROOT}/node_modules/.bin/tsc --noEmit`;
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(false);
  });

  it('does NOT match an electron Helper subprocess of an unrelated app', () => {
    // Electron forks lots of "Helper" processes. We deliberately do
    // NOT include "/Electron Helper" in COMMAND_PATTERNS — when we
    // SIGTERM the parent Electron process, macOS reaps the helpers.
    const cmd =
      '/Applications/Some.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper';
    expect(isStaleCommand(cmd, PROJECT_ROOT)).toBe(false);
  });

  it('exports a non-empty COMMAND_PATTERNS list (sanity)', () => {
    expect(Array.isArray(COMMAND_PATTERNS)).toBe(true);
    expect(COMMAND_PATTERNS.length).toBeGreaterThan(0);
    for (const p of COMMAND_PATTERNS) {
      expect(typeof p).toBe('string');
      expect(p.startsWith('/node_modules/')).toBe(true);
    }
  });
});
