import { describe, expect, it } from '@jest/globals';
import { classifyRemotionFailure } from './remotionErrorDiagnostics';

describe('remotionErrorDiagnostics', () => {
  it('classifies esbuild ENOTDIR spawn errors', () => {
    const details = classifyRemotionFailure({
      errorMessage:
        'Module build failed (from @remotion/bundler): Error: spawn ENOTDIR at ensureServiceIsRunning (/.../esbuild/lib/main.js:1982:29)',
      stage: 'bundling',
      packaged: true,
      remotionDir: '/tmp/remotion',
      esbuildBinaryPath: '/Applications/dhee.app/.../esbuild',
      resolvedModulePaths: {
        bundler: '/Applications/dhee.app/Contents/Resources/app.asar.unpacked/node_modules/@remotion/bundler/index.js',
        renderer: '/Applications/dhee.app/Contents/Resources/app.asar.unpacked/node_modules/@remotion/renderer/index.js',
        react: '/Applications/dhee.app/Contents/Resources/app.asar.unpacked/node_modules/react/package.json',
        esbuild: '/Applications/dhee.app/Contents/Resources/app.asar.unpacked/node_modules/esbuild/package.json',
      },
    });

    expect(details.code).toBe('esbuild_spawn_enotdir');
    expect(details.stage).toBe('bundling');
    expect(details.packaged).toBe(true);
    expect(details.esbuildBinaryPath).toContain('esbuild');
    expect(details.hint).toContain('app.asar.unpacked');
    expect(details.resolvedModulePaths?.bundler).toContain('@remotion/bundler');
  });

  it('falls back to generic failure classification', () => {
    const details = classifyRemotionFailure({
      errorMessage: 'ReferenceError: waterGrad is not defined',
      stage: 'rendering',
      packaged: false,
      remotionDir: '/tmp/remotion',
    });

    expect(details.code).toBe('remotion_render_failed');
    expect(details.stage).toBe('rendering');
    expect(details.hint).toBeUndefined();
    expect(details.resolvedModulePaths).toBeUndefined();
  });

  it('classifies app.asar module resolution failures', () => {
    const details = classifyRemotionFailure({
      errorMessage:
        'Module not found: Error: /Users/test/Library/Application Support/dhee-desktop/remotion-infographics/Applications/dhee.app/Contents/Resources/app.asar/node_modules/react/package.json (directory description file): Error: Invalid package /Applications/dhee.app/Contents/Resources/app.asar',
      stage: 'bundling',
      packaged: true,
      remotionDir: '/tmp/remotion',
    });

    expect(details.code).toBe('asar_runtime_module_resolution_failed');
    expect(details.stage).toBe('bundling');
    expect(details.hint).toContain('app.asar');
    expect(details.hint).toContain('latest desktop build');
  });

  it('classifies runtime preflight failures as asar resolution issues', () => {
    const details = classifyRemotionFailure({
      errorMessage:
        'Packaged runtime preflight failed: Remotion modules resolved to read-only app.asar.',
      stage: 'bundling',
      packaged: true,
      remotionDir: '/tmp/remotion',
      resolvedModulePaths: {
        bundler: '/Applications/dhee.app/Contents/Resources/app.asar/node_modules/@remotion/bundler/index.js',
        renderer: '/Applications/dhee.app/Contents/Resources/app.asar/node_modules/@remotion/renderer/index.js',
        react: '/Applications/dhee.app/Contents/Resources/app.asar/node_modules/react/package.json',
        esbuild: '/Applications/dhee.app/Contents/Resources/app.asar/node_modules/esbuild/package.json',
      },
    });

    expect(details.code).toBe('asar_runtime_module_resolution_failed');
    expect(details.resolvedModulePaths?.bundler).toContain('/app.asar/');
  });
});
