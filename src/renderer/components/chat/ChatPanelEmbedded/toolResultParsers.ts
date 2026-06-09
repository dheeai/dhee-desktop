/**
 * toolResultParsers — pull structured data out of the few tool results that
 * return formatted TEXT rather than a structured `details` object, so the
 * tool card can still render them first-class.
 *
 *  - dhee_get_status  → a "Status counts:" block (pending/in_progress/…)
 *  - dhee_list_versions → one "★ <id> via <tool> $<cost> → <path>" line per take
 *
 * Formats mirror dhee-core src/agent/pi/tools/{dheeGetStatus,dheeListVersions}.ts.
 */

export interface StatusCounts {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  total: number;
}

function countOf(text: string, label: string): number | null {
  const m = new RegExp(`${label}:\\s*(\\d+)`).exec(text);
  return m ? Number(m[1]) : null;
}

export function parseStatusCounts(text: string): StatusCounts | null {
  const pending = countOf(text, 'pending');
  const inProgress = countOf(text, 'in_progress');
  const completed = countOf(text, 'completed');
  const failed = countOf(text, 'failed');
  if (
    pending === null &&
    inProgress === null &&
    completed === null &&
    failed === null
  ) {
    return null;
  }
  const p = pending ?? 0;
  const ip = inProgress ?? 0;
  const c = completed ?? 0;
  const f = failed ?? 0;
  return {
    pending: p,
    inProgress: ip,
    completed: c,
    failed: f,
    total: p + ip + c + f,
  };
}

export interface VersionRow {
  id: string;
  selected: boolean;
  tool?: string;
  cost?: string;
  outputPath?: string;
}

export function parseVersionList(text: string): VersionRow[] {
  return (
    text
      .split('\n')
      // A version line always carries "via <tool>" and a "→ <path>".
      .filter((raw) => /\svia\s/.test(raw) && raw.includes('→'))
      .map((raw) => {
        const selected = raw.trimStart().startsWith('★');
        const body = raw.replace(/^\s*★?\s*/, '');
        const id = body.split(/\s+/)[0];
        const toolMatch = /\svia\s+(\S+)/.exec(body);
        const costMatch = /\$\d+(?:\.\d+)?/.exec(body);
        const pathMatch = /→\s*(.+)$/.exec(body);
        return {
          id,
          selected,
          ...(toolMatch ? { tool: toolMatch[1] } : {}),
          ...(costMatch ? { cost: costMatch[0] } : {}),
          ...(pathMatch ? { outputPath: pathMatch[1].trim() } : {}),
        };
      })
      .filter((row): row is VersionRow => row.id.length > 0)
  );
}
