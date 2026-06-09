/**
 * toolPresentation — pure helpers that turn a dhee_* tool name (and, later,
 * a tool message) into the primitives the chat UI renders.
 *
 * The dhee tool surface is finite and known (see dhee-core
 * `src/agent/pi/tools/index.ts` — DHEE_TOOL_NAMES), so we render every tool
 * call + result first-class instead of as a generic "working note". These
 * helpers decide WHICH card body an entry gets (archetype), give it a
 * humanized title (the raw dhee_* name is never shown to the user), and
 * classify failures the same way the background run-wake nudge does.
 */

import type { ChatMessage } from './chatMessageModel';
import { parseStatusCounts, parseVersionList } from './toolResultParsers';

export type ToolArchetype =
  | 'inspection'
  | 'edit'
  | 'artifact'
  | 'takes'
  | 'run'
  | 'ask'
  | 'bundle'
  | 'lifecycle'
  | 'fs'
  | 'generic';

/**
 * Render category per tool. Tools sharing a category share a card body.
 * Grounded in the real 26-tool surface; unknown / non-dhee tools (bash,
 * read, edit from the base agent) fall back to a generic card.
 */
const ARCHETYPE: Record<string, ToolArchetype> = {
  // inspection / audit — structured readouts
  dhee_get_status: 'inspection',
  dhee_check_resolution: 'inspection',
  dhee_check_workflow: 'inspection',
  // edit — mutate a node/input/setting; cascades downstream
  dhee_critique_node: 'edit',
  dhee_write_node_content: 'edit',
  dhee_regenerate_node: 'edit',
  dhee_write_input: 'edit',
  dhee_set_project_field: 'edit',
  dhee_swap_runner: 'edit',
  dhee_apply_workflow_aliases: 'edit',
  // artifact — show a produced file inline
  dhee_show_node_output: 'artifact',
  dhee_read_artifact: 'artifact',
  dhee_show_file: 'artifact',
  // takes — version / branch management
  dhee_list_versions: 'takes',
  dhee_select_version: 'takes',
  dhee_fork: 'takes',
  // run control — drives the activity transport
  dhee_start_run: 'run',
  dhee_stop_run: 'run',
  // interactive prompts — clickable, awaiting the user
  dhee_ask_question: 'ask',
  dhee_present_bundle_choices: 'ask',
  // bundle selection / inspection
  dhee_list_bundles: 'bundle',
  dhee_describe_bundle: 'bundle',
  // project lifecycle
  dhee_create_project: 'lifecycle',
  // scoped filesystem reads
  dhee_read: 'fs',
  dhee_ls: 'fs',
  dhee_grep: 'fs',
  dhee_find: 'fs',
};

export function toolArchetype(toolName: string): ToolArchetype {
  return ARCHETYPE[toolName] ?? 'generic';
}

/**
 * Curated, humanized verb phrase per tool — the title shown on the card
 * header. The component appends the object (node / file / item) separately
 * as a sub-label, so these stay as standalone verb phrases.
 */
const TITLES: Record<string, string> = {
  dhee_get_status: 'Checked the status',
  dhee_check_resolution: 'Checked resolutions',
  dhee_check_workflow: 'Checked the workflow',
  dhee_critique_node: 'Critiqued',
  dhee_write_node_content: 'Wrote',
  dhee_regenerate_node: 'Regenerated',
  dhee_write_input: 'Set the input',
  dhee_set_project_field: 'Updated a setting',
  dhee_swap_runner: 'Swapped the runner',
  dhee_apply_workflow_aliases: 'Remapped models',
  dhee_show_node_output: 'Showed',
  dhee_read_artifact: 'Read',
  dhee_show_file: 'Showed file',
  dhee_list_versions: 'Listed takes',
  dhee_select_version: 'Selected a take',
  dhee_fork: 'Forked a branch',
  dhee_start_run: 'Started the run',
  dhee_stop_run: 'Stopped the run',
  dhee_ask_question: 'Asked a question',
  dhee_present_bundle_choices: 'Offered bundle choices',
  dhee_list_bundles: 'Listed bundles',
  dhee_describe_bundle: 'Described a bundle',
  dhee_create_project: 'Created the project',
  dhee_read: 'Read a file',
  dhee_ls: 'Listed a folder',
  dhee_grep: 'Searched',
  dhee_find: 'Found files',
};

export function humanizeTool(toolName: string): string {
  const curated = TITLES[toolName];
  if (curated) return curated;
  const base = toolName
    .replace(/^dhee_/, '')
    .replace(/_/g, ' ')
    .trim();
  if (!base) return 'Worked';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Hints that mark a failure as a transient upstream blip (flaky Comfy
 * endpoint / tunnel / gateway) rather than a real, structural problem.
 *
 * Kept byte-for-byte in sync with `src/main/runWakeNudge.ts` TRANSIENT_HINTS
 * so the in-chat error card and the background run-wake nudge classify a
 * failure identically — the user should never see "transient, retry" in one
 * place and "structural, fix the node" in the other for the same error.
 */
const TRANSIENT_HINTS = [
  'transient upstream error after',
  '502',
  '503',
  '504',
  'bad gateway',
  'gateway time-out',
  'gateway timeout',
  'econnreset',
  'etimedout',
  'fetch failed',
  'socket hang up',
  'empty response',
  'no content',
];

export function classifyFailure(
  error: string | undefined,
): 'transient' | 'structural' {
  if (!error) return 'structural';
  const m = error.toLowerCase();
  return TRANSIENT_HINTS.some((h) => m.includes(h))
    ? 'transient'
    : 'structural';
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * The thing a tool acted on — rendered as the card's object sub-label
 * (e.g. "Critiqued <opening_beat>"). Pulled from the captured raw args.
 */
export function toolObject(message: ChatMessage): string | undefined {
  const args = message.toolArgs;
  if (!args) return undefined;
  const nodeId = typeof args.nodeId === 'string' ? args.nodeId : undefined;
  if (nodeId) {
    const itemId = typeof args.itemId === 'string' ? args.itemId : undefined;
    return itemId ? `${nodeId}:${itemId}` : nodeId;
  }
  const direct = (['inputId', 'name', 'bundleId', 'versionId'] as const)
    .map((k) => args[k])
    .find((v): v is string => typeof v === 'string' && v.length > 0);
  if (direct) return direct;
  const pathLike = (['filePath', 'path', 'workflowPath'] as const)
    .map((k) => args[k])
    .find((v): v is string => typeof v === 'string' && v.length > 0);
  if (pathLike) return basename(pathLike);
  return undefined;
}

/**
 * A compact outcome chip for the condensed (superseded) tool line — the
 * meaningful result at a glance ("28/40 done", "6 nodes", "3 takes",
 * "failed"). Undefined when there's no concise summary worth showing.
 */
export function resultChip(message: ChatMessage): string | undefined {
  if (message.toolStatus === 'error') return 'failed';
  const name = message.toolName ?? '';

  if (name === 'dhee_get_status' && message.toolResultText) {
    const counts = parseStatusCounts(message.toolResultText);
    if (counts && counts.total > 0) {
      return `${counts.completed}/${counts.total} done`;
    }
  }

  if (toolArchetype(name) === 'edit') {
    const nodes = message.toolDetails?.affectedNodes;
    if (Array.isArray(nodes) && nodes.length > 0)
      return `${nodes.length} nodes`;
  }

  if (name === 'dhee_list_versions' && message.toolResultText) {
    const versions = parseVersionList(message.toolResultText);
    if (versions.length > 0) return `${versions.length} takes`;
  }

  return undefined;
}
