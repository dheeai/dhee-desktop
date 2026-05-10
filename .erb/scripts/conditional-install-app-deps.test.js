const { describe, expect, it } = require('@jest/globals');
const { syncAppPackageJson } = require('./conditional-install-app-deps');

describe('conditional-install-app-deps syncAppPackageJson', () => {
  it('always mirrors root package version into release/app package', () => {
    const mainPackageJson = {
      name: 'kshana-desktop',
      version: '1.0.9',
      dependencies: {
        react: '^19.0.0',
      },
    };
    const existingAppPackageJson = {
      name: 'kshana-desktop',
      version: '1.0.8',
      dependencies: {
        react: '^18.0.0',
      },
    };

    const synced = syncAppPackageJson(mainPackageJson, existingAppPackageJson);

    expect(synced.version).toBe('1.0.9');
    expect(synced.dependencies.react).toBe('^19.0.0');
  });
});
