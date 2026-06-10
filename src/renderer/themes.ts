import type { ThemeId } from '../shared/settingsTypes';

export interface DesktopThemeOption {
  id: ThemeId;
  name: string;
  description: string;
  swatches: [string, string, string];
}

export const DESKTOP_THEMES: DesktopThemeOption[] = [
  {
    id: 'cinematic',
    name: 'Cinematic',
    description:
      'The official look — warm near-black film stock, Fraunces editorial type, a single amber accent.',
    swatches: ['#0a0908', '#1a1714', '#e8a33d'],
  },
  {
    id: 'deep-forest-gold',
    name: 'Deep Forest & Gold',
    description: 'Green-black panels with restrained gold focus.',
    swatches: ['#111613', '#2e392f', '#b08c49'],
  },
  {
    id: 'petroleum-clay',
    name: 'Petroleum & Clay',
    description: 'Petroleum darks with desaturated clay accents.',
    swatches: ['#14191c', '#2e4246', '#a9745e'],
  },
  {
    id: 'paper-light',
    name: 'Paper Light',
    description: 'Warm white surfaces with graphite contrast.',
    swatches: ['#f4efe7', '#ddd4c6', '#6f8599'],
  },
  {
    id: 'void-cut',
    name: 'Void Cut',
    description: 'Pitch-black with white accents and vivid timeline colors.',
    swatches: ['#0d0d0d', '#1e1e1e', '#ffffff'],
  },
];

export const DEFAULT_THEME_ID: ThemeId = 'cinematic';

export function isLightTheme(themeId: ThemeId): boolean {
  return themeId === 'paper-light';
}
