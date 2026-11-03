#!/usr/bin/env node
// Read-only audit. No renders, project mutations, credentials or network requests.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { coreRoot, inventory } from '../.agents/skills/dhee-production/scripts/core-guides.cjs';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--core-root')) throw new Error('Usage: audit-core-integration.mjs [--core-root <path>]');
const core = coreRoot(args[1]);
const req = createRequire(path.join(core, 'package.json'));
const { Client } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const client = new Client({ name: 'dhee-integration-audit', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(core, 'dist/mcp/cli.js')], env: { ...process.env, DHEE_NODE_MODULES_DIRS: JSON.stringify([path.join(desktop, 'packages')]) }, stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const timer = setTimeout(() => { process.stderr.write('MCP audit timed out\n'); process.exit(1); }, 15000);
let tools, identity;
try { await client.connect(transport); identity = client.getServerVersion(); tools = (await client.listTools()).tools; }
finally { await client.close(); clearTimeout(timer); }
const production = tools.find(t => t.name === 'dhee_production_control');
if (!production || identity.name !== 'dhee-core-production') throw new Error('Expected Core production MCP');
const actions = new Set();
function collect(value) {
  if (!value || typeof value !== 'object') return;
  const action = value.properties?.action;
  if (typeof action?.const === 'string') actions.add(action.const);
  for (const name of action?.enum || []) actions.add(name);
  for (const child of Object.values(value)) collect(child);
}
collect(production.inputSchema);
if (!actions.size) throw new Error('No discoverable production actions');
const guideFiles = inventory(core);
const sourceTools = path.join(core, 'src/agent/pi/tools/index.ts');
const embeddedTools = fs.existsSync(sourceTools) ? [...fs.readFileSync(sourceTools, 'utf8').split('export const DHEE_TOOL_NAMES = [')[1].split('] as const')[0].matchAll(/'(dhee_[^']+)'/g)].map(m => m[1]) : null;
const areas = [
 ['Project intake and bundle choice', ['project.create', 'bundle.list', 'bundle.describe', 'input.write'], ['dhee_create_project', 'dhee_list_bundles', 'dhee_describe_bundle', 'dhee_write_input']],
 ['Shot editing and reference replacement', ['node.critique', 'node.write', 'node.regenerate', 'reference.replace'], ['dhee_critique_node', 'dhee_write_node_content', 'dhee_regenerate_node', 'dhee_replace_character_reference']],
 ['Artifact and version browsing', ['artifact.read', 'version.list', 'version.restorePreview', 'version.restore', 'version.select'], ['dhee_read_artifact', 'dhee_list_versions', 'dhee_select_version']],
 ['Project configuration and budget', ['project.configure', 'budget.set'], ['dhee_set_project_field', 'dhee_set_budget_cap']],
 ['Creative approvals', ['review.enable', 'review.read', 'review.decide'], []],
 ['Selected GPU execution and recovery', ['gpu.catalog', 'gpu.targets', 'gpu.prepare', 'gpu.run', 'gpu.jobs', 'gpu.recovery.inspect', 'gpu.recovery.link'], []],
 ['Assembly and media checking', ['assembly.targets', 'assembly.run', 'media.check', 'media.read', 'scene.check'], []],
 ['Project execution and status', ['project.run', 'project.status'], []],
];
const capabilityReview = areas.map(([area, candidates, counterparts]) => ({ area, availableActions: candidates.filter(n => actions.has(n)), missingDedicatedOperations: candidates.filter(n => !actions.has(n)), embeddedCounterparts: counterparts.filter(n => embeddedTools?.includes(n)), note: 'Missing names are audit categories, not proposed/valid API calls. Embedded counterparts are not MCP tools; parity needs a separate design.' }));
const pkg = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
function exists(p) { return fs.existsSync(path.join(core, p)); }
const builtSkill = 'dist/skill/SKILL.md', sourceSkill = 'src/agent/pi/skill/SKILL.md';
const bundlesRoot = path.join(core, 'dist/bundles');
const bundles = fs.existsSync(bundlesRoot) ? fs.readdirSync(bundlesRoot).filter(n => fs.existsSync(path.join(bundlesRoot, n, 'bundle.json'))) : [];
const report = {
 generatedAt: new Date().toISOString(), coreRoot: core, desktopRoot: desktop,
 scope: 'Live read-only MCP handshake/discovery plus local files and packaging declarations. No generation, GPU availability test, signed-app launch or proof of full-film readiness.',
 mcp: { identity, tools: tools.map(t => t.name), actions: [...actions].sort() },
 guidance: { total: guideFiles.length, creative: guideFiles.filter(g => g.kind === 'creative').length, files: guideFiles, note: 'The Codex skill resolves these files on demand. MCP itself does not publish them as resources/prompts; bundle prompt injection is a separate connection.' },
 packaging: { declaredFiles: pkg.files, builtAgentSkillPresent: exists(builtSkill), builtAgentMatchesSource: exists(sourceSkill) && exists(builtSkill) ? fs.readFileSync(path.join(core, sourceSkill)).equals(fs.readFileSync(path.join(core, builtSkill))) : null, builtBundles: bundles, repositoryAuthoringSkillsShippedByFilesDeclaration: pkg.files.some(p => p === '.claude' || p.startsWith('.claude/')), note: 'File existence and package declarations are not installed-app acceptance.' },
 capabilityReview,
 remainingVerification: ['Final-delivery readiness behavior beyond saved version-bound technical reports', 'Three-shot generation through all creative gates and final assembly', 'Materials-to-full-film acceptance', 'Automated visual/voice correctness beyond recorded observations and technical audio checks', 'Packaged app startup without local harness workarounds and cross-platform acceptance', 'Fresh-session automatic selection of the Codex skill', 'Live GPU workflow/model availability and required provider credentials (not inspected by this audit)'],
};
console.log(JSON.stringify(report, null, 2));
