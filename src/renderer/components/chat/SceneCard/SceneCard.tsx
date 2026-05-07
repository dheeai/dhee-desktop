import { useState } from 'react';
import styles from './SceneCard.module.scss';

interface Shot {
  shotNumber: number;
  shotType: string;
  duration: number;
  prompt: string;
  dialogue?: string | null;
  cameraWork?: string;
  referenceImages?: string[];
}

interface SceneData {
  sceneNumber: number;
  sceneTitle?: string;
  shots: Shot[];
  totalSceneDuration?: number;
}

export interface SceneContentParseResult {
  sceneData: SceneData;
  leadingText: string;
  trailingText: string;
  remainingText: string;
}

interface SceneCardProps {
  data: SceneData;
}

function ShotRow({ shot }: { shot: Shot }) {
  const [expanded, setExpanded] = useState(false);

  const typeClass =
    styles[shot.shotType as keyof typeof styles] || styles.default;

  return (
    <div className={styles.shot}>
      <div className={styles.shotHeader}>
        <span className={styles.shotNumber}>#{shot.shotNumber}</span>
        <span className={`${styles.shotTypeBadge} ${typeClass}`}>
          {shot.shotType.replace(/_/g, ' ')}
        </span>
        <span className={styles.shotDuration}>{shot.duration}s</span>
      </div>

      {shot.prompt && (
        <>
          <div
            className={`${styles.prompt} ${expanded ? styles.expanded : ''}`}
            onClick={() => setExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
          >
            {shot.prompt}
          </div>
          {shot.prompt.length > 180 && (
            <button
              type="button"
              className={styles.promptToggle}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}

      {shot.dialogue && (
        <div className={styles.dialogue}>&ldquo;{shot.dialogue}&rdquo;</div>
      )}

      {shot.cameraWork && (
        <div className={styles.meta}>
          <span className={styles.metaIcon}>🎥</span>
          <span>{shot.cameraWork}</span>
        </div>
      )}
    </div>
  );
}

export default function SceneCard({ data }: SceneCardProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.sceneLabel}>Scene {data.sceneNumber}</span>
        {data.sceneTitle && (
          <span className={styles.sceneTitle}>{data.sceneTitle}</span>
        )}
        {data.totalSceneDuration != null && (
          <span className={styles.totalDuration}>
            {data.totalSceneDuration}s
          </span>
        )}
      </div>

      <div className={styles.shots}>
        {data.shots.map((shot) => (
          <ShotRow key={shot.shotNumber} shot={shot} />
        ))}
      </div>
    </div>
  );
}

function isSceneData(value: unknown): value is SceneData {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as SceneData).sceneNumber === 'number' &&
      Array.isArray((value as SceneData).shots) &&
      (value as SceneData).shots.length > 0,
  );
}

export function tryParseSceneData(content: string): SceneData | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = new Set<string>([trimmed]);
  const fencedBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedBlockMatch?.[1]) {
    candidates.add(fencedBlockMatch[1].trim());
  }

  // Some streamed/finalized messages arrive as an object body without the
  // outer braces, e.g. `"sceneNumber": 4, "sceneTitle": "...", "shots": [...]`.
  if (
    /"sceneNumber"\s*:/.test(trimmed) &&
    /"shots"\s*:/.test(trimmed) &&
    !trimmed.startsWith('{')
  ) {
    candidates.add(`{${trimmed}}`);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isSceneData(parsed)) {
        return parsed as SceneData;
      }
    } catch {
      // not valid JSON or not a scene
    }
  }

  return null;
}

function extractBalancedJsonObject(
  content: string,
  startIndex: number,
): string | null {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(startIndex, index + 1);
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function normalizeSceneText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'():[\]{}.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPromptFingerprint(prompt: string): string {
  // First N tokens of the normalized prompt as a verbatim signature.
  // Previously we filtered out short tokens (`the`, `of`, etc.) before
  // joining — but the trailing text we match against still contains
  // those small words, so the resulting fingerprint was never a
  // substring of the haystack. Keeping every token makes
  // `content.includes(fingerprint)` work for a literal restatement,
  // which is what `isDuplicateSceneSummary` is actually trying to
  // detect.
  return normalizeSceneText(prompt).split(' ').slice(0, 12).join(' ');
}

export function isDuplicateSceneSummary(
  content: string,
  sceneData: SceneData,
): boolean {
  const normalizedContent = normalizeSceneText(content);
  if (!normalizedContent) {
    return false;
  }

  const sceneHeader =
    normalizedContent.includes(`scene ${sceneData.sceneNumber}`) ||
    (sceneData.sceneTitle
      ? normalizedContent.includes(normalizeSceneText(sceneData.sceneTitle))
      : false);

  if (!sceneHeader) {
    return false;
  }

  const promptMatches = sceneData.shots.filter((shot) => {
    const fingerprint = buildPromptFingerprint(shot.prompt || '');
    return fingerprint.length > 0 && normalizedContent.includes(fingerprint);
  }).length;

  const cameraMatches = sceneData.shots.filter((shot) => {
    if (!shot.cameraWork) {
      return false;
    }
    return normalizedContent.includes(normalizeSceneText(shot.cameraWork));
  }).length;

  const shotLabelMatches = sceneData.shots.filter((shot) =>
    normalizedContent.includes(`shot ${shot.shotNumber}`),
  ).length;

  return (
    promptMatches >= Math.max(1, Math.ceil(sceneData.shots.length / 2)) &&
    (shotLabelMatches >= Math.max(1, sceneData.shots.length - 1) ||
      cameraMatches >= Math.max(1, Math.ceil(sceneData.shots.length / 2)))
  );
}

export function parseSceneContent(
  content: string,
): SceneContentParseResult | null {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return null;
  }

  const pureSceneData = tryParseSceneData(trimmedContent);
  if (pureSceneData) {
    return {
      sceneData: pureSceneData,
      leadingText: '',
      trailingText: '',
      remainingText: '',
    };
  }

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '{') {
      continue;
    }

    const candidate = extractBalancedJsonObject(content, index);
    if (!candidate) {
      continue;
    }

    const sceneData = tryParseSceneData(candidate);
    if (!sceneData) {
      continue;
    }

    const leadingText = content.slice(0, index).trim();
    const trailingText = content.slice(index + candidate.length).trim();
    const remainingText = [leadingText, trailingText]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    return {
      sceneData,
      leadingText,
      trailingText,
      remainingText,
    };
  }

  return null;
}
