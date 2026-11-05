const path = require('path');

/** Use the same Core checkout during verification, packing and bundle staging. */
function resolveCorePath(root, env = process.env) {
  const configured = [env.dhee_CORE_PATH, env.dhee_INK_PATH].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  return configured ? path.resolve(configured.trim()) : path.resolve(root, '..', 'dhee-core');
}

module.exports = { resolveCorePath };
