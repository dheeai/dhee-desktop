/**
 * Hardcoded template catalog used by the embedded chat panel's
 * new-project wizard. The legacy ChatPanel pulls this from the
 * fastify HTTP server's `/api/v1/templates` endpoint, but the
 * embedded variant runs against pi-agent in-process and has no HTTP
 * server. Keeping the catalog inline avoids an extra IPC channel
 * for static data.
 *
 * If you add a new template/style here, also add the matching preview
 * image to assets/previews/ — ProjectSetupPanel keys lookup by id.
 */
import type {
  SetupTemplateOption,
  SetupDurationOption,
  SetupRenderMethodOption,
} from '../ProjectSetupPanel/ProjectSetupPanel';

export const WIZARD_TEMPLATES: SetupTemplateOption[] = [
  {
    id: 'narrative',
    displayName: 'Narrative Story Video',
    description: 'Create a video from a story idea or complete narrative.',
    defaultStyle: 'cinematic_realism',
    styles: [
      {
        id: 'cinematic_realism',
        displayName: 'Cinematic Realism',
        description: 'Photorealistic cinematic style with dramatic lighting.',
      },
      {
        id: 'anime',
        displayName: 'Anime',
        description: 'Stylised 2D animation with painterly backgrounds.',
      },
    ],
  },
];

export const WIZARD_DURATION_PRESETS: Record<string, SetupDurationOption[]> = {
  narrative: [
    { label: '30 seconds', seconds: 30 },
    { label: '1 minute', seconds: 60 },
    { label: '2 minutes', seconds: 120 },
    { label: '3 minutes', seconds: 180 },
  ],
};

export const WIZARD_DEFAULT_TEMPLATE_ID = 'narrative';
export const WIZARD_DEFAULT_STYLE_ID = 'cinematic_realism';
export const WIZARD_DEFAULT_DURATION_SECONDS = 60;

/**
 * Render methods exposed in the new-project wizard. Mirrors the
 * canonical registry in `kshana-core/src/core/project/renderMethods.ts`.
 * Keep these in sync — id values must match.
 *
 * The choice gets persisted to `project.json` → `renderMethod` via
 * the `dhee_new` tool's `renderMethod` parameter. The project-level
 * dispatcher (runProjectInProcess) reads the field and routes
 * rendering accordingly. The pi-agent's role with this field is
 * editing later (dhee_set_render_method); the initial selection
 * happens here in the wizard.
 */
export const WIZARD_RENDER_METHODS: SetupRenderMethodOption[] = [
  {
    id: 'shot_by_shot',
    displayName: 'Shot-by-shot',
    description:
      'Render each shot independently with first + last frame anchors. Higher per-frame resolution, slower wall-clock. Works on any LTX-capable Comfy.',
  },
  {
    id: 'prompt_relay',
    displayName: 'Prompt relay',
    description:
      'Render whole scenes continuously via LTX Director. Better cross-shot motion fidelity and identity continuity, lower per-frame resolution. Requires the local Comfy box (cloud Comfy lacks the LTX Director custom nodes + LoRAs).',
  },
];

export const WIZARD_DEFAULT_RENDER_METHOD = 'shot_by_shot';
