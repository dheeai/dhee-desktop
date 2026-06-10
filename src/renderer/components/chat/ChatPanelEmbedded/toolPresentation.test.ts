import { describe, it, expect } from '@jest/globals';
import type { ChatMessage } from './chatMessageModel';
import {
  toolArchetype,
  humanizeTool,
  classifyFailure,
  toolObject,
  resultChip,
} from './toolPresentation';

function tool(extra: Partial<ChatMessage>): ChatMessage {
  return { id: 't', role: 'tool', ...extra };
}

describe('toolArchetype', () => {
  it('maps inspection tools', () => {
    expect(toolArchetype('dhee_get_status')).toBe('inspection');
    expect(toolArchetype('dhee_check_workflow')).toBe('inspection');
    expect(toolArchetype('dhee_check_resolution')).toBe('inspection');
  });

  it('maps edit / cascade tools', () => {
    for (const t of [
      'dhee_critique_node',
      'dhee_write_node_content',
      'dhee_regenerate_node',
      'dhee_write_input',
      'dhee_set_project_field',
      'dhee_swap_runner',
      'dhee_apply_workflow_aliases',
    ]) {
      expect(toolArchetype(t)).toBe('edit');
    }
  });

  it('maps artifact-display tools', () => {
    for (const t of ['dhee_show_node_output', 'dhee_read_artifact', 'dhee_show_file']) {
      expect(toolArchetype(t)).toBe('artifact');
    }
  });

  it('maps version / takes tools', () => {
    for (const t of ['dhee_list_versions', 'dhee_select_version', 'dhee_fork']) {
      expect(toolArchetype(t)).toBe('takes');
    }
  });

  it('maps run-control tools', () => {
    expect(toolArchetype('dhee_start_run')).toBe('run');
    expect(toolArchetype('dhee_stop_run')).toBe('run');
  });

  it('maps interactive-prompt tools', () => {
    expect(toolArchetype('dhee_ask_question')).toBe('ask');
    expect(toolArchetype('dhee_present_bundle_choices')).toBe('ask');
  });

  it('maps bundle tools', () => {
    expect(toolArchetype('dhee_list_bundles')).toBe('bundle');
    expect(toolArchetype('dhee_describe_bundle')).toBe('bundle');
  });

  it('maps project-lifecycle tools', () => {
    expect(toolArchetype('dhee_create_project')).toBe('lifecycle');
  });

  it('maps scoped filesystem tools', () => {
    for (const t of ['dhee_read', 'dhee_ls', 'dhee_grep', 'dhee_find']) {
      expect(toolArchetype(t)).toBe('fs');
    }
  });

  it('falls back to generic for unknown / non-dhee tools', () => {
    expect(toolArchetype('bash')).toBe('generic');
    expect(toolArchetype('some_future_tool')).toBe('generic');
  });
});

describe('humanizeTool', () => {
  it('never surfaces the raw dhee_* name or snake_case', () => {
    for (const t of [
      'dhee_get_status',
      'dhee_critique_node',
      'dhee_show_node_output',
      'dhee_list_versions',
      'dhee_create_project',
      'dhee_grep',
    ]) {
      const title = humanizeTool(t);
      expect(title).not.toMatch(/dhee_/);
      expect(title).not.toContain('_');
      expect(title.length).toBeGreaterThan(0);
      expect(title[0]).toBe(title[0].toUpperCase());
    }
  });

  it('uses curated phrasings for known tools', () => {
    expect(humanizeTool('dhee_get_status')).toBe('Checked the status');
    expect(humanizeTool('dhee_critique_node')).toBe('Critiqued');
    expect(humanizeTool('dhee_write_node_content')).toBe('Wrote');
    expect(humanizeTool('dhee_show_node_output')).toBe('Showed');
    expect(humanizeTool('dhee_list_versions')).toBe('Listed takes');
    expect(humanizeTool('dhee_start_run')).toBe('Started the run');
  });

  it('humanizes an unknown dhee_* tool by stripping the prefix', () => {
    expect(humanizeTool('dhee_warp_drive')).toBe('Warp drive');
  });

  it('humanizes a non-dhee tool name', () => {
    expect(humanizeTool('bash')).toBe('Bash');
  });
});

describe('classifyFailure', () => {
  it('flags transient upstream / gateway / socket errors', () => {
    for (const e of [
      'comfy.image: transient upstream error after 3 attempts — 502',
      'Gateway Time-out',
      'ECONNRESET',
      'fetch failed',
      'socket hang up',
      'llm.generate: LLM returned empty response (no content).',
    ]) {
      expect(classifyFailure(e)).toBe('transient');
    }
  });

  it('treats schema / not-found errors as structural', () => {
    expect(classifyFailure('schema validation failed: mood not in enum')).toBe(
      'structural',
    );
    expect(classifyFailure('node 999 not found')).toBe('structural');
  });

  it('treats missing error text as structural (no transient signal)', () => {
    expect(classifyFailure(undefined)).toBe('structural');
  });
});

describe('toolObject', () => {
  it('returns the node id the tool acted on', () => {
    expect(
      toolObject(tool({ toolName: 'dhee_critique_node', toolArgs: { nodeId: 'opening_beat' } })),
    ).toBe('opening_beat');
  });

  it('joins nodeId:itemId for a collection item', () => {
    expect(
      toolObject(
        tool({
          toolName: 'dhee_show_node_output',
          toolArgs: { nodeId: 'shot_image', itemId: 'scene_1_shot_3' },
        }),
      ),
    ).toBe('shot_image:scene_1_shot_3');
  });

  it('falls back to inputId / name / basename(path)', () => {
    expect(toolObject(tool({ toolArgs: { inputId: 'transcript' } }))).toBe('transcript');
    expect(
      toolObject(tool({ toolName: 'dhee_create_project', toolArgs: { name: "Maya's Awakening" } })),
    ).toBe("Maya's Awakening");
    expect(toolObject(tool({ toolArgs: { path: '/proj/script/scene_03.md' } }))).toBe(
      'scene_03.md',
    );
  });

  it('is undefined when there is no recognizable object', () => {
    expect(toolObject(tool({ toolName: 'dhee_get_status', toolArgs: { projectDir: '/x' } }))).toBeUndefined();
    expect(toolObject(tool({}))).toBeUndefined();
  });
});

describe('resultChip', () => {
  it('summarizes status counts', () => {
    expect(
      resultChip(
        tool({
          toolName: 'dhee_get_status',
          toolStatus: 'completed',
          toolResultText:
            'Status counts:\n  pending:     11\n  in_progress: 1\n  completed:   28\n  failed:      0',
        }),
      ),
    ).toBe('28/40 done');
  });

  it('counts cascade affected nodes for an edit', () => {
    expect(
      resultChip(
        tool({
          toolName: 'dhee_critique_node',
          toolStatus: 'completed',
          toolDetails: { affectedNodes: ['a', 'b', 'c', 'd', 'e', 'f'] },
        }),
      ),
    ).toBe('6 nodes');
  });

  it('counts takes for a version list', () => {
    expect(
      resultChip(
        tool({
          toolName: 'dhee_list_versions',
          toolStatus: 'completed',
          toolResultText:
            'Versions for shot_07 (3 candidates):\n★ v3 via ltx → /a\n  v2 via ltx → /b\n  v1 via flux → /c',
        }),
      ),
    ).toBe('3 takes');
  });

  it('marks a failed tool', () => {
    expect(
      resultChip(tool({ toolName: 'dhee_critique_node', toolStatus: 'error', toolResultText: 'boom' })),
    ).toBe('failed');
  });

  it('is undefined for tools with no concise chip', () => {
    expect(resultChip(tool({ toolName: 'dhee_fork', toolStatus: 'completed' }))).toBeUndefined();
  });
});
