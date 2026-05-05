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
