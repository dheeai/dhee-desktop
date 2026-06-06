import { createElement, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertCircle, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import styles from './ToolCallCard.module.scss';
import { resolveMediaSrc } from '../ChatPanelEmbedded/mediaResolution';
import SceneCard, {
  isDuplicateSceneSummary,
  parseSceneContent,
} from '../SceneCard';

export type ToolCallStatus =
  | 'executing'
  | 'completed'
  | 'error'
  | 'needs_confirmation';

export interface ToolCallCardProps {
  toolName: string;
  args?: Record<string, unknown>;
  status?: ToolCallStatus;
  result?: unknown;
  duration?: number;
  toolCallId?: string;
  agentName?: string;
  streamingContent?: string;
  onFileClick?: (filePath: string) => void;
}

// Tools with special rendering
const SPECIAL_RENDER_TOOLS = new Set([
  'think',
  'write_project_state',
  'read_project_state',
  'dispatch_agent',
]);

// User-friendly display names
const TOOL_DISPLAY_NAMES: Record<string, { gerund: string; past: string }> = {
  think: { gerund: 'Thinking', past: 'Thought' },
  ask_user: { gerund: 'Asking user', past: 'Asked user' },
  dispatch_agent: { gerund: 'Dispatching agent', past: 'Dispatched agent' },
  generate_image: { gerund: 'Generating image', past: 'Generated image' },
  generate_video: { gerund: 'Generating video', past: 'Generated video' },
  edit_image: { gerund: 'Editing image', past: 'Edited image' },
  wait_for_job: { gerund: 'Waiting for job', past: 'Job completed' },
  read_project_state: {
    gerund: 'Reading project state',
    past: 'Read project state',
  },
  write_project_state: {
    gerund: 'Saving project state',
    past: 'Saved project state',
  },
};

function getDisplayName(toolName: string, isExecuting: boolean): string {
  const names = TOOL_DISPLAY_NAMES[toolName];
  if (!names) {
    return isExecuting ? `Running ${toolName}` : `Ran ${toolName}`;
  }
  return isExecuting ? names.gerund : names.past;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function getStreamingPercent(content: string): number | null {
  const matches = Array.from(content.matchAll(/(\d+)%/g));
  if (matches.length === 0) {
    return null;
  }

  const percent = Number(matches[matches.length - 1]?.[1]);
  if (!Number.isFinite(percent)) {
    return null;
  }

  return Math.max(0, Math.min(100, percent));
}

function formatToolCall(name: string, args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) {
    return `${name}()`;
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}=${JSON.stringify(value, null, 2)}`);
    } else if (value !== null && typeof value === 'object') {
      parts.push(`${key}=${JSON.stringify(value, null, 2)}`);
    }
  }

  return `${name}(${parts.join(', ')})`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

type CompactToolSummary = {
  projectName?: string;
  phase?: string;
  phaseStatus?: string;
  completedPhasesCount?: number;
  activeBatches?: number;
  activeImageBatches?: number;
  activeVideoBatches?: number;
  failedBatches?: number;
  failedVideoBatches?: number;
  assetsCount?: number;
  warning?: string;
  nextSteps: string[];
};

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function toDisplayPhase(phase: string): string {
  return phase
    .split('_')
    .filter(Boolean)
    .map((part) => capitalize(part))
    .join(' ');
}

function extractTopNextSteps(nextAction: string | undefined): string[] {
  if (!nextAction) return [];
  const lines = nextAction
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.replace(/^\*\*(.+)\*\*$/, '$1'))
    .map((line) => line.replace(/^[-*]\s+/, ''))
    .map((line) => line.replace(/^\d+\.\s+/, ''))
    .map((line) => line.replace(/\*\*/g, ''))
    .filter((line) => !/^phase ready/i.test(line));

  return lines.slice(0, 3);
}

function buildCompactSummary(
  toolName: string,
  resultObj: Record<string, unknown>,
): CompactToolSummary | null {
  if (toolName !== 'read_project' && toolName !== 'read_background_generation') {
    return null;
  }

  const summary: CompactToolSummary = {
    nextSteps: extractTopNextSteps(
      typeof resultObj.next_action === 'string' ? resultObj.next_action : undefined,
    ),
  };

  const errorText =
    typeof resultObj.error === 'string'
      ? resultObj.error
      : typeof resultObj.message === 'string' && resultObj.status === 'error'
        ? resultObj.message
        : undefined;
  if (errorText) {
    summary.warning = errorText;
  }

  const project = getRecord(resultObj.project);
  if (project) {
    if (typeof project.title === 'string') {
      summary.projectName = project.title;
    }
    if (typeof project.currentPhase === 'string') {
      summary.phase = toDisplayPhase(project.currentPhase);
    }

    const phases = getRecord(project.phases);
    if (phases) {
      let completedCount = 0;
      let currentPhaseStatus: string | undefined;
      const currentPhaseKey =
        typeof project.currentPhase === 'string' ? project.currentPhase : undefined;
      for (const [phaseKey, phaseValue] of Object.entries(phases)) {
        const phaseObj = getRecord(phaseValue);
        const phaseStatus = typeof phaseObj?.status === 'string' ? phaseObj.status : '';
        if (phaseStatus === 'completed') {
          completedCount += 1;
        }
        if (currentPhaseKey && phaseKey === currentPhaseKey) {
          currentPhaseStatus = phaseStatus;
        }
      }
      summary.completedPhasesCount = completedCount;
      if (currentPhaseStatus) {
        summary.phaseStatus = currentPhaseStatus.replace(/_/g, ' ');
      }
    }

    if (Array.isArray(project.assets)) {
      summary.assetsCount = project.assets.length;
    }

    const backgroundGeneration = getRecord(project.backgroundGeneration);
    if (backgroundGeneration) {
      const batches = Array.isArray(backgroundGeneration.batches)
        ? backgroundGeneration.batches
        : [];
      summary.activeBatches = batches.filter((batch) => {
        const batchObj = getRecord(batch);
        return batchObj?.status === 'running' || batchObj?.status === 'queued';
      }).length;
      summary.activeImageBatches = batches.filter((batch) => {
        const batchObj = getRecord(batch);
        return (
          batchObj?.kind === 'image' &&
          (batchObj?.status === 'running' || batchObj?.status === 'queued')
        );
      }).length;
      summary.activeVideoBatches = batches.filter((batch) => {
        const batchObj = getRecord(batch);
        return (
          batchObj?.kind === 'video' &&
          (batchObj?.status === 'running' || batchObj?.status === 'queued')
        );
      }).length;
      summary.failedBatches = batches.filter((batch) => {
        const batchObj = getRecord(batch);
        return (
          batchObj?.status === 'failed' ||
          (typeof batchObj?.failedItems === 'number' && batchObj.failedItems > 0)
        );
      }).length;
    }
  }

  if (toolName === 'read_background_generation') {
    if (Array.isArray(resultObj.active_batch_ids)) {
      summary.activeBatches = resultObj.active_batch_ids.length;
    }

    const batches = Array.isArray(resultObj.batches) ? resultObj.batches : [];
    summary.activeImageBatches = batches.filter((batch) => {
      const batchObj = getRecord(batch);
      return (
        batchObj?.kind === 'image' &&
        (batchObj?.status === 'running' || batchObj?.status === 'queued')
      );
    }).length;
    summary.activeVideoBatches = batches.filter((batch) => {
      const batchObj = getRecord(batch);
      return (
        batchObj?.kind === 'video' &&
        (batchObj?.status === 'running' || batchObj?.status === 'queued')
      );
    }).length;
    summary.failedVideoBatches = batches.filter((batch) => {
      const batchObj = getRecord(batch);
      return (
        batchObj?.kind === 'video' &&
        (batchObj?.status === 'failed' ||
          (typeof batchObj?.failed_items === 'number' && batchObj.failed_items > 0))
      );
    }).length;
  }

  const hasSignal =
    Boolean(summary.projectName) ||
    Boolean(summary.phase) ||
    Boolean(summary.phaseStatus) ||
    summary.completedPhasesCount !== undefined ||
    summary.activeBatches !== undefined ||
    summary.assetsCount !== undefined ||
    Boolean(summary.warning) ||
    summary.nextSteps.length > 0;

  return hasSignal ? summary : null;
}

function formatObjectAsText(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  const nameField = obj.name || obj.title;
  const roleField = obj.role;

  if (nameField) {
    let line = String(nameField);
    if (roleField) {
      line += ` (${roleField})`;
    }
    parts.push(line);
  }

  for (const [key, value] of Object.entries(obj)) {
    if (['name', 'title', 'role'].includes(key)) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(`${capitalize(key)}: ${value}`);
    }
  }

  return parts.join(' | ');
}

function formatProjectStateData(
  data: Record<string, unknown>,
  indent = 0,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const prefix = '  '.repeat(indent);

  for (const [key, value] of Object.entries(data)) {
    const capitalizedKey = capitalize(key);

    if (Array.isArray(value)) {
      nodes.push(
        <div key={key} className={styles.projectStateKey}>
          {prefix}
          <span className={styles.projectStateLabel}>{capitalizedKey}:</span>
        </div>,
      );
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          const formattedText = formatObjectAsText(obj);
          nodes.push(
            <div key={`${key}-${i}`} className={styles.projectStateValue}>
              {prefix} - {formattedText}
            </div>,
          );
        } else {
          nodes.push(
            <div key={`${key}-${i}`} className={styles.projectStateValue}>
              {prefix} - {String(item)}
            </div>,
          );
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      nodes.push(
        <div key={key} className={styles.projectStateKey}>
          {prefix}
          <span className={styles.projectStateLabel}>{capitalizedKey}:</span>
        </div>,
      );
      nodes.push(
        ...formatProjectStateData(value as Record<string, unknown>, indent + 1),
      );
    } else {
      nodes.push(
        <div key={key} className={styles.projectStateItem}>
          {prefix}
          <span className={styles.projectStateLabel}>{capitalizedKey}: </span>
          <span className={styles.projectStateValue}>{String(value)}</span>
        </div>,
      );
    }
  }

  return nodes;
}

function renderThinkTool(
  args: Record<string, unknown> | undefined,
  status: ToolCallStatus | undefined,
): React.ReactNode {
  const thought = args?.thought as string | undefined;
  const isExecuting = status === 'executing';

  return (
    <div className={styles.thinkTool}>
      <div className={styles.thinkHeader}>
        <span className={styles.thinkIcon}>💭</span>
        {isExecuting ? (
          <span className={styles.thinkText}>Thinking...</span>
        ) : (
          <span className={styles.thinkText}>{thought || 'Thinking...'}</span>
        )}
      </div>
      {thought && !isExecuting && (
        <div className={styles.thinkContent}>
          <ReactMarkdown>{thought}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function renderDispatchAgentTool(
  args: Record<string, unknown> | undefined,
  status: ToolCallStatus | undefined,
  result?: unknown,
): React.ReactNode {
  const task = args?.task as string | undefined;
  const context = args?.context as string | undefined;
  const isExecuting = status === 'executing';

  const resultObj = result as Record<string, unknown> | undefined;
  const plan = resultObj?.plan as string | undefined;

  return (
    <div className={styles.dispatchAgentTool}>
      <div className={styles.dispatchHeader}>
        {isExecuting ? (
          <>
            <span className={styles.dispatchIcon}>📝</span>
            <span className={styles.dispatchText}> Planning...</span>
          </>
        ) : (
          <span className={styles.dispatchText}>📝 Plan Complete</span>
        )}
      </div>
      <div className={styles.dispatchContent}>
        {task && (
          <div className={styles.dispatchSection}>
            <div className={styles.dispatchLabel}>Task:</div>
            <div className={styles.dispatchValue}>{task}</div>
          </div>
        )}
        {context && (
          <div className={styles.dispatchSection}>
            <div className={styles.dispatchLabel}>Context:</div>
            <div className={styles.dispatchValue}>{context}</div>
          </div>
        )}
        {plan && !isExecuting && (
          <div className={styles.dispatchSection}>
            <div className={styles.dispatchLabel}>Plan:</div>
            <div className={styles.dispatchPlan}>
              <ReactMarkdown>{plan}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderProjectStateTool(
  toolName: string,
  args: Record<string, unknown> | undefined,
  status: ToolCallStatus | undefined,
): React.ReactNode {
  const dataType = args?.data_type as string | undefined;
  const rawData = args?.data;
  const isExecuting = status === 'executing';
  const isRead = toolName === 'read_project_state';

  let data: Record<string, unknown> | undefined;
  if (typeof rawData === 'string') {
    try {
      data = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      data = { value: rawData };
    }
  } else if (typeof rawData === 'object' && rawData !== null) {
    data = rawData as Record<string, unknown>;
  }

  const capitalizedDataType = capitalize(dataType || 'unknown');

  return (
    <div className={styles.projectStateTool}>
      <div className={styles.projectStateHeader}>
        {isExecuting ? (
          <>
            <span className={styles.projectStateIcon}>
              {isRead ? '📖' : '📋'}
            </span>
            <span className={styles.projectStateText}>
              {isRead ? 'Reading' : 'Saving'} project state...
            </span>
          </>
        ) : (
          <>
            <span className={styles.projectStateIcon}>
              {isRead ? '📖' : '📋'}
            </span>
            <span className={styles.projectStateText}>
              {isRead ? 'Project State: ' : 'Project State Update: '}
            </span>
            <span className={styles.projectStateDataType}>
              {capitalizedDataType}
            </span>
          </>
        )}
      </div>
      {!isExecuting && data && (
        <div className={styles.projectStateData}>
          {formatProjectStateData(data)}
        </div>
      )}
    </div>
  );
}

export function shouldToolStartExpanded(): boolean {
  return false;
}

export default function ToolCallCard({
  toolName,
  args,
  status = 'executing',
  result,
  duration,
  agentName,
  streamingContent,
  onFileClick,
}: ToolCallCardProps) {
  const isExecuting = status === 'executing';
  const trimmedStreamingContent = streamingContent?.trim() ?? '';
  const showStreamingContent = isExecuting && trimmedStreamingContent.length > 0;
  const streamingSceneContent = showStreamingContent
    ? parseSceneContent(trimmedStreamingContent)
    : null;
  const streamingPercent = showStreamingContent
    ? getStreamingPercent(trimmedStreamingContent)
    : null;

  const [isExpanded, setIsExpanded] = useState(() => shouldToolStartExpanded());

  useEffect(() => {
    if (showStreamingContent) {
      setIsExpanded(true);
    }
  }, [showStreamingContent]);

  const isError = status === 'error';
  const isCompleted = status === 'completed';

  // CLI-style format: [TOOL] toolName
  const prefix = agentName ? `[${agentName}]` : '[TOOL]';

  // Format result for display - extract key information like file paths
  let resultDisplay = '';
  let filePath: string | undefined;
  let fileSize: string | undefined;
  let preview: string | undefined;
  let summaryText: string | undefined;
  let nextActionText: string | undefined;
  let compactSummary: CompactToolSummary | null = null;
  let rawDetails: string | undefined;

  if (result !== undefined) {
    if (typeof result === 'object' && result !== null) {
      const resultObj = result as Record<string, unknown>;
      const isProjectSummaryTool =
        toolName === 'read_project' || toolName === 'read_background_generation';

      // Extract file information (common in Task tool results)
      if ('file_path' in resultObj || 'filePath' in resultObj) {
        filePath = (resultObj.file_path || resultObj.filePath) as string;
      }
      if ('file_saved' in resultObj && filePath) {
        // File was saved
      }
      if ('size' in resultObj) {
        const size = resultObj.size as number;
        fileSize =
          size < 1024 ? `${size} bytes` : `${(size / 1024).toFixed(1)} KB`;
      }
      if ('preview' in resultObj) {
        preview = String(resultObj.preview);
      }
      if ('summary' in resultObj && typeof resultObj.summary === 'string') {
        summaryText = resultObj.summary;
      }
      if (
        'next_action' in resultObj &&
        typeof resultObj.next_action === 'string'
      ) {
        nextActionText = resultObj.next_action;
      }
      compactSummary = buildCompactSummary(toolName, resultObj);

      // Check if result has content field (like dispatch_content_agent results)
      if ('content' in resultObj && typeof resultObj.content === 'string') {
        resultDisplay = String(resultObj.content);
      } else if (
        'output' in resultObj &&
        typeof resultObj.output === 'string'
      ) {
        resultDisplay = String(resultObj.output);
      } else if (filePath && !resultDisplay) {
        // If we have a file path but no content, show the file path
        resultDisplay = `File: ${filePath}`;
      } else if (summaryText || nextActionText) {
        // Structured guidance results are rendered in dedicated sections below.
        resultDisplay = '';
      } else if (isProjectSummaryTool) {
        // Keep project/background payload behind details; default to summary-first UI.
        resultDisplay = '';
      } else {
        // Show full object result in expanded view
        resultDisplay = JSON.stringify(result, null, 2);
      }

      if (isProjectSummaryTool) {
        summaryText = undefined;
        nextActionText = undefined;
        rawDetails = JSON.stringify(result, null, 2);
      }
    } else {
      resultDisplay = String(result);
    }
  }

  const resultSceneContent =
    resultDisplay && toolName === 'generate_content'
      ? parseSceneContent(resultDisplay)
      : null;

  const borderClass = isExecuting
    ? styles.borderExecuting
    : isError
      ? styles.borderError
      : isCompleted
        ? styles.borderCompleted
        : styles.borderDefault;

  const toolCallText = formatToolCall(toolName, args);

  return (
    <div className={`${styles.container} ${borderClass}`}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {createElement(ChevronRight as any, {
          size: 14,
          className: isExpanded ? styles.chevronExpanded : styles.chevron,
        })}
        {isExecuting ? (
          createElement(AlertCircle as any, {
            size: 14,
            className: styles.statusIconExecuting,
          })
        ) : isError ? (
          createElement(XCircle as any, {
            size: 14,
            className: styles.statusIconError,
          })
        ) : (
          createElement(CheckCircle2 as any, {
            size: 14,
            className: styles.statusIconCompleted,
          })
        )}
        <span className={styles.toolName}>{toolName}</span>
        <span className={styles.cliPrefix}>{prefix}</span>
        <span className={styles.cliToolName}>
          {isExecuting ? 'Running' : isError ? 'Failed' : 'Success'}
        </span>
        {!isExecuting && duration !== undefined && duration > 0 && (
          <span className={styles.duration}>{formatDuration(duration)}</span>
        )}
      </button>

      {isExpanded && (
        <div className={styles.content}>
          <div className={styles.toolCall}>
            <span className={styles.toolCallCode}>{toolCallText}</span>
          </div>

          {showStreamingContent && (
            <div className={styles.streamingContent}>
              <div className={styles.streamingLabel}>Live output</div>
              {streamingSceneContent ? (
                <>
                  <SceneCard data={streamingSceneContent.sceneData} />
                  {streamingSceneContent.remainingText &&
                    !isDuplicateSceneSummary(
                      streamingSceneContent.remainingText,
                      streamingSceneContent.sceneData,
                    ) && (
                      <div className={styles.resultContentMarkdown}>
                        <ReactMarkdown>
                          {streamingSceneContent.remainingText}
                        </ReactMarkdown>
                      </div>
                    )}
                </>
              ) : (
                <>
                  {streamingPercent !== null && (
                    <div className={styles.streamingProgressBar}>
                      <div
                        className={styles.streamingProgressFill}
                        style={{ width: `${streamingPercent}%` }}
                      />
                    </div>
                  )}
                  <pre className={styles.streamingPre}>
                    {trimmedStreamingContent}
                  </pre>
                </>
              )}
            </div>
          )}

          {!isExecuting &&
            (filePath ||
              fileSize ||
              resultDisplay ||
              summaryText ||
              nextActionText ||
              compactSummary) && (
            <div className={styles.cliResult}>
              {compactSummary && (
                <div className={styles.summaryCard}>
                  <div className={styles.resultLabel}>Summary</div>
                  <ul className={styles.summaryList}>
                    {compactSummary.projectName && (
                      <li>Project: {compactSummary.projectName}</li>
                    )}
                    {compactSummary.phase && (
                      <li>
                        Phase: {compactSummary.phase}
                        {compactSummary.phaseStatus
                          ? ` (${compactSummary.phaseStatus})`
                          : ''}
                      </li>
                    )}
                    {compactSummary.completedPhasesCount !== undefined && (
                      <li>Completed phases: {compactSummary.completedPhasesCount}</li>
                    )}
                    {compactSummary.activeBatches !== undefined && (
                      <li>Background batches active: {compactSummary.activeBatches}</li>
                    )}
                    {(compactSummary.activeImageBatches !== undefined ||
                      compactSummary.activeVideoBatches !== undefined) && (
                      <li>
                        Image batches: {compactSummary.activeImageBatches ?? 0} ·
                        Video batches: {compactSummary.activeVideoBatches ?? 0}
                      </li>
                    )}
                    {(compactSummary.failedBatches !== undefined ||
                      compactSummary.failedVideoBatches !== undefined) && (
                      <li>
                        Failed batches: {compactSummary.failedBatches ?? 0}
                        {compactSummary.failedVideoBatches !== undefined
                          ? ` (video: ${compactSummary.failedVideoBatches})`
                          : ''}
                      </li>
                    )}
                    {compactSummary.assetsCount !== undefined && (
                      <li>Assets generated: {compactSummary.assetsCount}</li>
                    )}
                  </ul>
                  {compactSummary.warning && (
                    <div className={styles.summaryWarning}>{compactSummary.warning}</div>
                  )}
                  {compactSummary.nextSteps.length > 0 && (
                    <div className={styles.summaryNextSteps}>
                      <div className={styles.resultLabel}>Next</div>
                      <ul className={styles.summaryList}>
                        {compactSummary.nextSteps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {filePath && (
                <button
                  type="button"
                  className={styles.cliFilePath}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFileClick?.(filePath);
                  }}
                  title="Click to open in Preview"
                >
                  📄 {filePath}
                  {fileSize && (
                    <span className={styles.cliFileSize}> ({fileSize})</span>
                  )}
                </button>
              )}
              {/* Phase 6.5c.b: inline media render for show_node_output /
                  show_file results. Detect by file extension; pi-agent's
                  dhee_show_* tools surface details.file_path that
                  ToolCallCard extracts at lines 559-561 above. */}
              {filePath && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(filePath) && (
                <img
                  src={resolveMediaSrc(filePath, null)}
                  alt={filePath}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 400,
                    borderRadius: 6,
                    marginTop: 8,
                    display: 'block',
                  }}
                />
              )}
              {filePath && /\.(mp4|mov|webm|mkv|m4v)$/i.test(filePath) && (
                <video
                  src={resolveMediaSrc(filePath, null)}
                  controls
                  style={{
                    maxWidth: '100%',
                    maxHeight: 400,
                    borderRadius: 6,
                    marginTop: 8,
                    display: 'block',
                  }}
                />
              )}
              {filePath && /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(filePath) && (
                <audio
                  src={resolveMediaSrc(filePath, null)}
                  controls
                  style={{ marginTop: 8, display: 'block' }}
                />
              )}
              {preview && (
                <div className={styles.cliPreview}>
                  <details>
                    <summary>Preview</summary>
                    <pre className={styles.cliResultPre}>{preview}</pre>
                  </details>
                </div>
              )}
              {resultDisplay && (
                <div className={styles.cliResultContent}>
                  {resultSceneContent ? (
                    <>
                      <SceneCard data={resultSceneContent.sceneData} />
                      {resultSceneContent.remainingText &&
                        !isDuplicateSceneSummary(
                          resultSceneContent.remainingText,
                          resultSceneContent.sceneData,
                        ) && (
                          <div className={styles.resultContentMarkdown}>
                            <ReactMarkdown>
                              {resultSceneContent.remainingText}
                            </ReactMarkdown>
                          </div>
                        )}
                    </>
                  ) : typeof result === 'object' &&
                    result !== null &&
                    'content' in result ? (
                    <ReactMarkdown>{resultDisplay}</ReactMarkdown>
                  ) : (
                    <pre className={styles.cliResultPre}>{resultDisplay}</pre>
                  )}
                </div>
              )}
              {summaryText && (
                <div className={styles.cliResultContent}>
                  <div className={styles.resultLabel}>Summary</div>
                  <pre className={styles.cliResultPre}>{summaryText}</pre>
                </div>
              )}
              {nextActionText && (
                <div className={styles.cliResultContent}>
                  <div className={styles.resultLabel}>Next Action</div>
                  <div className={styles.resultContentMarkdown}>
                    <ReactMarkdown>{nextActionText}</ReactMarkdown>
                  </div>
                </div>
              )}
              {rawDetails && (
                <div className={styles.cliPreview}>
                  <details>
                    <summary>Details</summary>
                    <pre className={styles.cliResultPre}>{rawDetails}</pre>
                  </details>
                </div>
              )}
            </div>
            )}

          {isError && !resultDisplay && (
            <div className={styles.errorResult}>
              <div className={styles.errorLabel}>Error</div>
              <pre className={styles.errorMessage}>Tool failed.</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
