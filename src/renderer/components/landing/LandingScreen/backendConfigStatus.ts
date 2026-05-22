/**
 * Per-lane "is this backend configured enough to actually do work?"
 * checks. Used by the landing screen status pill (red dot when a lane
 * is missing config) and the warn-before-new-project dialog (refuses
 * to create until the user has at least one working LLM + Comfy).
 *
 * "Configured" means:
 *   - cloud mode: the user is signed in (and for Comfy, has a cloud
 *     API key on top of the sign-in)
 *   - local mode: the URL/key the provider actually needs is set
 *
 * Pure helpers — no IPC, no filesystem. Inputs are the settings blob
 * + the cached account info. Same logic the runtime side will hit
 * when it tries to make a real call.
 */

import type { AccountInfo, AppSettings } from '../../../../shared/settingsTypes';

export type LaneId = 'llm' | 'comfy' | 'vlm';

export interface LaneConfigCheck {
  lane: LaneId;
  configured: boolean;
  /** Short human-readable reason when unconfigured ('No API key',
   *  'Sign in required', 'Comfy URL not set'). Empty when configured. */
  reason: string;
}

/**
 * Check a single lane. `vlm` uses the same LLM credentials by default
 * (the VLM judge calls into the LLM stack), so its check reduces to
 * the LLM check when `vlmBackend === 'local'`.
 */
export function checkLaneConfigured(
  lane: LaneId,
  settings: AppSettings | null | undefined,
  account: AccountInfo | null | undefined,
): LaneConfigCheck {
  if (!settings) {
    return { lane, configured: false, reason: 'Settings unavailable' };
  }

  if (lane === 'comfy') {
    if (settings.comfyBackend === 'cloud') {
      if (!account) {
        return { lane, configured: false, reason: 'Sign in to Dhee Cloud' };
      }
      if (!settings.comfyCloudApiKey || !settings.comfyCloudApiKey.trim()) {
        return { lane, configured: false, reason: 'Comfy Cloud API key missing' };
      }
      return { lane, configured: true, reason: '' };
    }
    // local
    if (!settings.comfyuiUrl || !settings.comfyuiUrl.trim()) {
      return { lane, configured: false, reason: 'ComfyUI URL not set' };
    }
    return { lane, configured: true, reason: '' };
  }

  // LLM + VLM both run against the configured LLM stack.
  const backend =
    lane === 'llm' ? settings.llmBackend : settings.vlmBackend;
  if (backend === 'cloud') {
    if (!account) {
      return { lane, configured: false, reason: 'Sign in to Dhee Cloud' };
    }
    return { lane, configured: true, reason: '' };
  }

  // local — depends on provider
  switch (settings.llmProvider) {
    case 'lmstudio':
      if (!settings.lmStudioUrl || !settings.lmStudioUrl.trim()) {
        return { lane, configured: false, reason: 'LM Studio URL not set' };
      }
      return { lane, configured: true, reason: '' };
    case 'gemini':
      if (!settings.googleApiKey || !settings.googleApiKey.trim()) {
        return { lane, configured: false, reason: 'Gemini API key missing' };
      }
      return { lane, configured: true, reason: '' };
    case 'openai':
      if (!settings.openaiApiKey || !settings.openaiApiKey.trim()) {
        return { lane, configured: false, reason: 'OpenAI API key missing' };
      }
      return { lane, configured: true, reason: '' };
    case 'openrouter':
      if (!settings.openRouterApiKey || !settings.openRouterApiKey.trim()) {
        return { lane, configured: false, reason: 'OpenRouter API key missing' };
      }
      return { lane, configured: true, reason: '' };
    default:
      return { lane, configured: false, reason: 'LLM provider not chosen' };
  }
}

export interface BackendConfigStatus {
  llm: LaneConfigCheck;
  comfy: LaneConfigCheck;
  vlm: LaneConfigCheck;
  /** True if EVERY lane is configured. Use to gate "+ New Project". */
  allConfigured: boolean;
  /** Lanes that need attention, in display order. Empty when allConfigured. */
  unconfiguredLanes: LaneConfigCheck[];
}

/**
 * Run all three lane checks. The `unconfiguredLanes` array is what
 * the warn-before-create dialog renders — one row per problematic
 * lane with its specific reason.
 */
export function getBackendConfigStatus(
  settings: AppSettings | null | undefined,
  account: AccountInfo | null | undefined,
): BackendConfigStatus {
  const llm = checkLaneConfigured('llm', settings, account);
  const comfy = checkLaneConfigured('comfy', settings, account);
  const vlm = checkLaneConfigured('vlm', settings, account);
  const unconfiguredLanes = [llm, comfy, vlm].filter((c) => !c.configured);
  return {
    llm,
    comfy,
    vlm,
    allConfigured: unconfiguredLanes.length === 0,
    unconfiguredLanes,
  };
}
