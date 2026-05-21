const fs = require('fs');
const path = require('path');

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing`);
  }
  return value;
}

function optionalEnv(env, name) {
  const value = env[name]?.trim();
  return value || undefined;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function buildRuntimeConfig(env = process.env) {
  const dheeWebsiteUrl = stripTrailingSlash(requiredEnv(env, 'dhee_WEBSITE_URL'));
  const posthogApiKey = requiredEnv(env, 'POSTHOG_API_KEY');
  const posthogHost = stripTrailingSlash(
    optionalEnv(env, 'POSTHOG_HOST') || DEFAULT_POSTHOG_HOST,
  );
  const analyticsSalt = optionalEnv(env, 'ANALYTICS_SALT');

  return {
    dheeWebsiteUrl,
    posthogApiKey,
    posthogHost,
    ...(analyticsSalt ? { analyticsSalt } : {}),
  };
}

function writeRuntimeConfig({
  env = process.env,
  outputPath = path.join(__dirname, '..', '..', 'assets', 'runtime-config.json'),
} = {}) {
  const config = buildRuntimeConfig(env);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function main() {
  const outputPath = process.argv[2] || undefined;
  const config = writeRuntimeConfig({ outputPath });
  console.log(
    [
      '[write-runtime-config] Wrote assets/runtime-config.json',
      'posthogApiKey=set',
      `posthogHost=${config.posthogHost}`,
      `analyticsSalt=${config.analyticsSalt ? 'set' : 'unset'}`,
    ].join(' '),
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(
      '[write-runtime-config]',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_POSTHOG_HOST,
  buildRuntimeConfig,
  writeRuntimeConfig,
};
