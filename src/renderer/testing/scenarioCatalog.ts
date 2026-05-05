/**
 * Bundled catalog of test scenarios. Statically imports the JSON files
 * from `tests/e2e/scenarios/` so manual testing in test-bridge mode can
 * pick a scenario without devtools paste-fu.
 *
 * Adding a new scenario? Drop the JSON in `tests/e2e/scenarios/` and
 * add an entry below — the picker in `TestApp` reads from this map.
 */
import type { Scenario } from './installFakeBridge';
import showS1Shot1 from '../../../tests/e2e/scenarios/show-s1-shot-1.json';
import editShot1 from '../../../tests/e2e/scenarios/edit-shot-1.json';
import editErrorThenRetry from '../../../tests/e2e/scenarios/edit-error-then-retry.json';
import iterativeEdits from '../../../tests/e2e/scenarios/iterative-edits.json';
import editWithStreaming from '../../../tests/e2e/scenarios/edit-with-streaming.json';
import streamingOnlyReply from '../../../tests/e2e/scenarios/streaming-only-reply.json';

export interface ScenarioEntry {
  scenario: Scenario;
  /** What to type into the chat to drive each rule, in order. */
  prompts: string[];
  /** One-line description of what the user should expect to see. */
  expect: string;
}

export const SCENARIO_CATALOG: Record<string, ScenarioEntry> = {
  'show-s1-shot-1': {
    scenario: showS1Shot1 as Scenario,
    prompts: ['show me s1 shot 1'],
    expect:
      'image_text_to_image tool card + generated image + "Here is s1 shot 1."',
  },
  'edit-shot-1': {
    scenario: editShot1 as Scenario,
    prompts: ['show me s1 shot 1', 'make it darker and more cinematic'],
    expect:
      'two images (v1, v2) stacked, two tool cards (text_to_image + image_edit), "Updated s1 shot 1…"',
  },
  'edit-error-then-retry': {
    scenario: editErrorThenRetry as Scenario,
    prompts: [
      'show me s1 shot 1',
      'make it darker',
      'try again with more grain',
    ],
    expect:
      'failed edit shows ✗ glyph + [error] notification + "Edit failed". Retry succeeds with v2 + "Recovered…"',
  },
  'iterative-edits': {
    scenario: iterativeEdits as Scenario,
    prompts: [
      'show me s1 shot 1',
      'now make it darker',
      'now make it more vibrant',
      'add fog',
    ],
    expect:
      'four stacked images (v1 → v4) with three distinct image_edit tool cards',
  },
  'edit-with-streaming': {
    scenario: editWithStreaming as Scenario,
    prompts: ['show me s1 shot 1', 'make it more dramatic'],
    expect:
      'streamed reasoning bubble appears first ("Analyzing the source frame…"), then image_edit fires + v2_dramatic image + a SEPARATE final bubble ("Pushed contrast…")',
  },
  'streaming-only-reply': {
    scenario: streamingOnlyReply as Scenario,
    prompts: ['explain s1 shot 1'],
    expect:
      'streamed text builds in one bubble; final agent_response REPLACES the streamed text — never duplicates (regression pin for documented bug)',
  },
};

export type ScenarioName = keyof typeof SCENARIO_CATALOG;

export function listScenarioNames(): string[] {
  return Object.keys(SCENARIO_CATALOG);
}

export function getScenarioByName(name: string): Scenario | null {
  const entry = SCENARIO_CATALOG[name];
  return entry ? entry.scenario : null;
}
