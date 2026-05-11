/**
 * Context Index (.dhee/context/index.json)
 * Location: <ProjectName>/.dhee/context/index.json
 * Owner: Agent (ContextStore)
 * Purpose: Index of context variables stored in .md documents
 */

import type { ContextSource } from './common';

/**
 * Metadata for a stored context variable
 */
export interface StoredContextMeta {
  /** Variable name (matches the key in ContextIndex) */
  variable_name: string;

  /** Human-readable label */
  label: string;

  /** ISO8601 timestamp of creation */
  created_at: string;

  /** Character count of the content */
  char_count: number;

  /** Source of the context */
  source: ContextSource;
}

/**
 * Context index mapping variable names to metadata
 */
export interface ContextIndex {
  [name: string]: StoredContextMeta;
}

/**
 * Creates a new StoredContextMeta entry
 */
export function createContextMeta(
  variableName: string,
  label: string,
  charCount: number,
  source: ContextSource = 'tool',
): StoredContextMeta {
  return {
    variable_name: variableName,
    label,
    created_at: new Date().toISOString(),
    char_count: charCount,
    source,
  };
}

/**
 * Creates an empty context index
 */
export function createDefaultContextIndex(): ContextIndex {
  return {};
}

/**
 * Adds or updates a context entry in the index
 */
export function upsertContextEntry(
  index: ContextIndex,
  variableName: string,
  label: string,
  charCount: number,
  source: ContextSource = 'tool',
): ContextIndex {
  return {
    ...index,
    [variableName]: createContextMeta(variableName, label, charCount, source),
  };
}

/**
 * Removes a context entry from the index
 */
export function removeContextEntry(
  index: ContextIndex,
  variableName: string,
): ContextIndex {
  const newIndex = { ...index };
  delete newIndex[variableName];
  return newIndex;
}

/**
 * Gets all context entries as an array
 */
export function getContextEntries(index: ContextIndex): StoredContextMeta[] {
  return Object.values(index);
}

/**
 * Gets context entries filtered by source
 */
export function getContextEntriesBySource(
  index: ContextIndex,
  source: ContextSource,
): StoredContextMeta[] {
  return Object.values(index).filter((entry) => entry.source === source);
}
