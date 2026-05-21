const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, expect, it } = require('@jest/globals');
const {
  DEFAULT_POSTHOG_HOST,
  buildRuntimeConfig,
  writeRuntimeConfig,
} = require('./write-runtime-config');

describe('write-runtime-config', () => {
  it('builds a release config with PostHog fields and defaults the host', () => {
    const config = buildRuntimeConfig({
      dhee_WEBSITE_URL: 'https://dhee.studio/',
      POSTHOG_API_KEY: ' phc_release ',
      ANALYTICS_SALT: ' salt-1 ',
    });

    expect(config).toEqual({
      dheeWebsiteUrl: 'https://dhee.studio',
      posthogApiKey: 'phc_release',
      posthogHost: DEFAULT_POSTHOG_HOST,
      analyticsSalt: 'salt-1',
    });
  });

  it('fails fast when the release PostHog API key is missing', () => {
    expect(() =>
      buildRuntimeConfig({
        dhee_WEBSITE_URL: 'https://dhee.studio',
      }),
    ).toThrow('POSTHOG_API_KEY is missing');
  });

  it('writes runtime-config.json without leaking empty optional fields', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhee-runtime-config-'));
    const outputPath = path.join(root, 'assets', 'runtime-config.json');

    const config = writeRuntimeConfig({
      outputPath,
      env: {
        dhee_WEBSITE_URL: 'https://dhee.studio',
        POSTHOG_API_KEY: 'phc_release',
        POSTHOG_HOST: 'https://eu.i.posthog.com/',
        ANALYTICS_SALT: '',
      },
    });

    expect(config).toEqual({
      dheeWebsiteUrl: 'https://dhee.studio',
      posthogApiKey: 'phc_release',
      posthogHost: 'https://eu.i.posthog.com',
    });
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(config);
  });
});
