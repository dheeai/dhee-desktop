/**
 * Run-cockpit vocabulary helpers.
 *
 * The cockpit is bundle-agnostic — it must read the same for a narrative
 * video bundle and a financial-report bundle. So every human-facing word
 * is DERIVED from the bundle's own node ids + artifact formats here, never
 * hardcoded to "shots" / "rendering". Pure functions; see vocab.test.ts.
 */

/** snake_case / kebab-case / camelCase id → "Title Case" label. */
export function humanizeId(id: string | undefined | null): string {
  if (!id) return '';
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase())
    .join(' ');
}

/**
 * The verb the transport bar uses for the active phase, chosen by the
 * active stage's artifact format. Deliberately generic — an unknown
 * format yields "Working", never a video-specific word.
 */
export function phaseVerb(format: string | undefined | null): string {
  switch (format) {
    case 'image':
    case 'video':
      return 'Rendering';
    case 'audio':
      return 'Composing';
    case 'json':
    case 'md':
    case 'txt':
      return 'Writing';
    case 'pdf':
      return 'Assembling';
    default:
      return 'Working';
  }
}

/**
 * Count-aware, intentionally naive pluralizer for the counter's unit noun
 * ("7 / 23 shot images"). Leaves an already-plural noun untouched and
 * handles sibilant tails (box → boxes); good enough for a label.
 */
export function pluralizeNoun(noun: string, count: number): string {
  if (count === 1) return noun;
  const sibilant = /(ss|x|z|ch|sh)$/i.test(noun);
  if (sibilant) return `${noun}es`;
  if (/s$/i.test(noun)) return noun; // already plural-ish
  return `${noun}s`;
}
