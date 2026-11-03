#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function coreRoot(explicit) {
  const desktop = path.resolve(fs.realpathSync(__dirname), '../../../..');
  const candidate = explicit || process.env.dhee_CORE_PATH || process.env.dhee_INK_PATH || path.resolve(desktop, '../dhee-core');
  const root = fs.realpathSync(candidate);
  if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name !== 'dhee-core') throw new Error('Expected a dhee-core checkout or package root');
  return root;
}
function inventory(root) {
  const entries = [];
  function add(id, relative, kind) {
    const full = fs.realpathSync(path.join(root, relative));
    const rel = path.relative(root, full);
    if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Guide escapes Core root');
    const data = fs.readFileSync(full);
    entries.push({ id, kind, path: relative, sha256: crypto.createHash('sha256').update(data).digest('hex') });
  }
  function walk(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + item.name;
      if (item.isDirectory()) walk(path.join(dir, item.name), relative + '/');
      else if (item.isFile() && item.name.endsWith('.md')) add(relative.slice(0, -3), 'prompts/skills/' + relative, 'creative');
    }
  }
  walk(path.join(root, 'prompts/skills'));
  for (const name of ['dhee', 'bundle-authoring', 'runner-authoring', 'test-loop']) {
    const relative = `.claude/skills/${name}/SKILL.md`;
    if (fs.existsSync(path.join(root, relative))) add('authoring/' + name, relative, 'repository');
  }
  const agent = ['src/agent/pi/skill/SKILL.md', 'dist/skill/SKILL.md'].find(p => fs.existsSync(path.join(root, p)));
  if (agent) add('agent/dhee', agent, 'embedded-agent');
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
function main(args) {
  const i = args.indexOf('--core-root');
  let explicit;
  if (i !== -1) { if (!args[i + 1]) throw new Error('--core-root requires a path'); explicit = args[i + 1]; args.splice(i, 2); }
  const [command, id] = args;
  if (!['list', 'read'].includes(command) || args.length !== (command === 'read' ? 2 : 1)) throw new Error('Usage: core-guides.cjs list|read <id> [--core-root <path>]');
  const root = coreRoot(explicit);
  const guides = inventory(root);
  if (command === 'list') console.log(JSON.stringify({ coreRoot: root, guides }, null, 2));
  else {
    const guide = guides.find(g => g.id === id);
    if (!guide) throw new Error(`Guide not found: ${id}; run list to discover available guidance`);
    process.stdout.write(fs.readFileSync(path.join(root, guide.path), 'utf8'));
  }
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { coreRoot, inventory };
