/**
 * Desktop Logger - Captures screen output to log files.
 * Mirrors the CLI's uiLogger.ts functionality for Desktop sessions.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const UI_LOG_PATH = path.join(LOG_DIR, 'ui-output.log');
const PHASE_LOG_PATH = path.join(LOG_DIR, 'phase.log');
const WORKFLOW_LOG_PATH = path.join(LOG_DIR, 'workflow.log');

// Ensure logs directory exists
function ensureLogDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // Ignore directory creation errors
  }
}

/**
 * Write a line to a log file.
 */
function writeLog(filePath: string, line: string): void {
  try {
    ensureLogDir();
    fs.appendFileSync(filePath, `${line}\n`);
  } catch {
    // Ignore write errors
  }
}

/**
 * Initialize the UI log file for a new session.
 */
export function initUILog(): void {
  try {
    ensureLogDir();
    const header = `════════════════════════════════════════════════════════════════════════════════
 dhee DESKTOP SESSION LOG
 Started: ${new Date().toISOString()}
════════════════════════════════════════════════════════════════════════════════
`;
    fs.writeFileSync(UI_LOG_PATH, header);
  } catch {
    // Ignore initialization errors
  }
}

/**
 * Log user input - matches the user message in chat.
 * Format: "👤 You: [content]"
 */
export function logUserInput(content: string): void {
  writeLog(UI_LOG_PATH, '');
  writeLog(
    UI_LOG_PATH,
    '┌──────────────────────────────────────────────────────────────────────────────┐',
  );
  writeLog(UI_LOG_PATH, '│ 👤 You:');
  const lines = content.split('\n');
  for (const line of lines) {
    writeLog(UI_LOG_PATH, `│ ${line}`);
  }
  writeLog(
    UI_LOG_PATH,
    '└──────────────────────────────────────────────────────────────────────────────┘',
  );
}

/**
 * Log agent text - matches assistant messages in chat.
 */
export function logAgentText(text: string, agentName?: string): void {
  if (!text.trim()) return;
  writeLog(UI_LOG_PATH, '');
  const prefix = agentName ? `[${agentName}] ` : '';
  const lines = text.split('\n');
  for (const line of lines) {
    writeLog(UI_LOG_PATH, `${prefix}${line}`);
  }
}

/**
 * Log tool call start - matches tool execution state.
 * Format: "◉ [Spinner] Running toolname"
 */
export function logToolStart(
  toolName: string,
  args?: Record<string, unknown>,
): void {
  writeLog(UI_LOG_PATH, '');
  writeLog(
    UI_LOG_PATH,
    `┌─ 🔧 ${getToolDisplayName(toolName, true)} ─────────────────────────────────────`,
  );
  if (args && Object.keys(args).length > 0) {
    writeLog(UI_LOG_PATH, `│ ${formatToolCall(toolName, args)}`);
  }
}

/**
 * Log tool call completion - matches tool completion state.
 * Format: "✓ Ran toolname (duration)"
 */
export function logToolComplete(
  toolName: string,
  result: unknown,
  duration?: number,
  isError = false,
): void {
  const icon = isError ? '✗' : '✓';
  const durationStr = duration ? ` (${formatDuration(duration)})` : '';
  writeLog(
    UI_LOG_PATH,
    `│ ${icon} ${getToolDisplayName(toolName, false)}${durationStr}`,
  );

  // Log result for non-hidden tools
  if (!isHiddenTool(toolName)) {
    const resultStr = formatResult(result, isError);
    if (resultStr) {
      const lines = resultStr.split('\n');
      for (const line of lines) {
        writeLog(UI_LOG_PATH, `│ ${line}`);
      }
    }
  }
  writeLog(
    UI_LOG_PATH,
    '└──────────────────────────────────────────────────────────────────────────────',
  );
}

/**
 * Log question prompt - matches QuestionPrompt component.
 */
export function logQuestion(
  question: string,
  options?: Array<{ label: string; description?: string }>,
  isConfirmation = false,
  autoApproveTimeoutMs?: number,
): void {
  writeLog(UI_LOG_PATH, '');
  writeLog(
    UI_LOG_PATH,
    '┌─ ❓ Question ────────────────────────────────────────────────────────────────┐',
  );
  writeLog(UI_LOG_PATH, `│ ${question}`);

  if (options && options.length > 0) {
    writeLog(UI_LOG_PATH, '│');
    options.forEach((opt, i) => {
      const selected = i === 0 ? '>' : ' ';
      const desc = opt.description ? ` - ${opt.description}` : '';
      writeLog(UI_LOG_PATH, `│ ${selected} ${i + 1}. ${opt.label}${desc}`);
    });
  } else if (isConfirmation) {
    writeLog(UI_LOG_PATH, '│');
    writeLog(UI_LOG_PATH, '│   Press y for Yes, n for No');
  }

  if (autoApproveTimeoutMs) {
    writeLog(UI_LOG_PATH, '│');
    writeLog(
      UI_LOG_PATH,
      `│ Auto-approve in ${Math.ceil(autoApproveTimeoutMs / 1000)}s`,
    );
  }
  writeLog(
    UI_LOG_PATH,
    '└──────────────────────────────────────────────────────────────────────────────┘',
  );
}

/**
 * Log status bar change - matches StatusBar component.
 */
export function logStatusChange(
  status: string,
  agentName?: string,
  message?: string,
): void {
  const statusDisplay: Record<string, string> = {
    idle: '○ Idle',
    thinking: '● Thinking...',
    waiting: '? Waiting for input',
    completed: '✓ Completed',
    error: '✗ Error',
    executing: '● Executing',
  };
  const display = statusDisplay[status] || status;
  const name = agentName || 'Agent';
  const msg = message ? `: ${message}` : '';
  writeLog(UI_LOG_PATH, `[${name}] ${display}${msg}`);
}

/**
 * Log phase transition.
 */
export function logPhaseTransition(
  fromPhase: string,
  toPhase: string,
  success: boolean,
  reason?: string,
): void {
  const timestamp = new Date().toISOString();
  const icon = success ? '✓' : '✗';

  // Log to UI log
  writeLog(UI_LOG_PATH, '');
  writeLog(
    UI_LOG_PATH,
    `════════════════════════════════════════════════════════════════════════════════`,
  );
  writeLog(UI_LOG_PATH, `${icon} Phase Transition: ${fromPhase} → ${toPhase}`);
  if (reason) {
    writeLog(UI_LOG_PATH, `   Reason: ${reason}`);
  }
  writeLog(
    UI_LOG_PATH,
    `════════════════════════════════════════════════════════════════════════════════`,
  );

  // Log to phase log
  try {
    ensureLogDir();
    const phaseLogEntry = `[${timestamp}] ${icon} [Workflow] phase_transition: ${fromPhase} → ${toPhase}${reason ? ` (${reason})` : ''}\n`;
    fs.appendFileSync(PHASE_LOG_PATH, phaseLogEntry);
  } catch {
    // Ignore write errors
  }

  // Log to workflow log
  try {
    ensureLogDir();
    const workflowLogEntry = `[${timestamp}] [PHASE_TRANSITION] ${success ? 'Transition succeeded' : 'Transition failed'}\n  {\n    "from": "${fromPhase}",\n    "to": "${toPhase}",\n    "success": ${success}${reason ? `,\n    "reason": "${reason}"` : ''}\n  }\n\n`;
    fs.appendFileSync(WORKFLOW_LOG_PATH, workflowLogEntry);
  } catch {
    // Ignore write errors
  }
}

/**
 * Log todo list - matches TodoList component.
 */
export function logTodoUpdate(
  todos: Array<{ content: string; status: string }>,
): void {
  if (todos.length === 0) return;

  const completed = todos.filter((t) => t.status === 'completed').length;

  writeLog(UI_LOG_PATH, '');
  writeLog(
    UI_LOG_PATH,
    `┌─ 📋 Todos (${completed}/${todos.length}) ─────────────────────────────────────────────────`,
  );
  todos.forEach((todo) => {
    const icon =
      todo.status === 'completed'
        ? '✓'
        : todo.status === 'in_progress'
          ? '●'
          : '○';
    writeLog(UI_LOG_PATH, `│ ${icon} ${todo.content}`);
  });
  writeLog(
    UI_LOG_PATH,
    '└──────────────────────────────────────────────────────────────────────────────',
  );
}

/**
 * Log error display - matches error state.
 */
export function logError(
  error: string,
  context?: Record<string, unknown>,
): void {
  writeLog(UI_LOG_PATH, '');
  writeLog(UI_LOG_PATH, `✗ Error: ${error}`);
  if (context) {
    const contextStr = JSON.stringify(context, null, 2);
    const lines = contextStr.split('\n');
    for (const line of lines) {
      writeLog(UI_LOG_PATH, `  ${line}`);
    }
  }
}

export interface FileOpFailureLogContext {
  operation: string;
  rawPath: string;
  normalizedPath?: string;
  resolvedPath?: string;
  activeProjectRoot?: string;
  errorCode?: string;
  errorMessage: string;
  opId?: string | null;
  sessionId?: string | null;
  projectDirectory?: string | null;
}

/**
 * Log structured file operation failures for cross-process debugging.
 */
export function logFileOpFailure(context: FileOpFailureLogContext): void {
  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    operation: context.operation,
    rawPath: context.rawPath,
    normalizedPath: context.normalizedPath ?? null,
    resolvedPath: context.resolvedPath ?? null,
    activeProjectRoot: context.activeProjectRoot ?? null,
    errorCode: context.errorCode ?? 'FILE_OP_FAILED',
    errorMessage: context.errorMessage,
    opId: context.opId ?? null,
    sessionId: context.sessionId ?? null,
    projectDirectory: context.projectDirectory ?? null,
  };

  writeLog(UI_LOG_PATH, '');
  writeLog(UI_LOG_PATH, `✗ File operation failed: ${context.operation}`);
  const uiLines = JSON.stringify(payload, null, 2).split('\n');
  for (const line of uiLines) {
    writeLog(UI_LOG_PATH, `  ${line}`);
  }

  try {
    ensureLogDir();
    const workflowLogEntry = `[${timestamp}] [FILE_OP_FAILURE] ${JSON.stringify(payload)}\n`;
    fs.appendFileSync(WORKFLOW_LOG_PATH, workflowLogEntry);
  } catch {
    // Ignore write errors
  }
}

/**
 * Log streaming text chunk.
 */
export function logStreamChunk(chunk: string): void {
  // Don't log individual chunks to avoid log spam
  // Only log when stream completes (handled by logAgentText)
}

/**
 * Log session end.
 */
export function logSessionEnd(): void {
  writeLog(UI_LOG_PATH, '');
  writeLog(
    UI_LOG_PATH,
    '════════════════════════════════════════════════════════════════════════════════',
  );
  writeLog(UI_LOG_PATH, ' SESSION ENDED');
  writeLog(UI_LOG_PATH, ` Ended: ${new Date().toISOString()}`);
  writeLog(
    UI_LOG_PATH,
    '════════════════════════════════════════════════════════════════════════════════',
  );
}

/**
 * Get the log file paths.
 */
export function getLogPaths(): {
  uiLog: string;
  phaseLog: string;
  workflowLog: string;
} {
  return {
    uiLog: UI_LOG_PATH,
    phaseLog: PHASE_LOG_PATH,
    workflowLog: WORKFLOW_LOG_PATH,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions (matching CLI uiLogger.ts logic)
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_DISPLAY_NAMES: Record<string, { gerund: string; past: string }> = {
  think: { gerund: 'Thinking', past: 'Thought' },
  AskUserQuestion: { gerund: 'Asking user', past: 'Asked user' },
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
  read_project: { gerund: 'Reading project', past: 'Read project' },
  update_project: { gerund: 'Updating project', past: 'Updated project' },
  read_file: { gerund: 'Reading file', past: 'Read file' },
  write_file: { gerund: 'Writing file', past: 'Wrote file' },
  TodoWrite: { gerund: 'Updating todos', past: 'Updated todos' },
  todo_write: { gerund: 'Updating todos', past: 'Updated todos' },
};

const HIDDEN_TOOLS = new Set([
  'TodoWrite',
  'todo_write',
  'update_project',
  'read_project',
  'read_file',
  'write_file',
]);

function isHiddenTool(toolName: string): boolean {
  return HIDDEN_TOOLS.has(toolName);
}

function getToolDisplayName(toolName: string, isExecuting: boolean): string {
  const names = TOOL_DISPLAY_NAMES[toolName];
  if (!names) {
    return isExecuting ? `Running ${toolName}` : `Ran ${toolName}`;
  }
  return isExecuting ? names.gerund : names.past;
}

function formatToolCall(name: string, args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) {
    return `${name}()`;
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      // Truncate very long strings
      const truncated =
        value.length > 200 ? `${value.substring(0, 200)}...` : value;
      parts.push(`${key}="${truncated}"`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[Array(${value.length})]`);
    } else if (value !== null && typeof value === 'object') {
      parts.push(`${key}={Object}`);
    }
  }

  return `${name}(${parts.join(', ')})`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatResult(result: unknown, isError: boolean): string {
  if (result === undefined || result === null) return '';

  const resultObj = result as Record<string, unknown>;

  // For errors, show the error
  if (isError || resultObj.status === 'error') {
    return `Error: ${resultObj.error || resultObj.warning || JSON.stringify(result, null, 2)}`;
  }

  // For loop warnings
  if (
    resultObj.status === 'loop_warning' ||
    resultObj.status === 'loop_blocked'
  ) {
    return String(resultObj.warning);
  }

  // Special handling for subagent file save results
  if (
    resultObj.status === 'completed' &&
    (resultObj.file_saved || resultObj.file_path || resultObj.output_file)
  ) {
    const lines: string[] = [];
    const filePath = (resultObj.file_path || resultObj.output_file) as
      | string
      | undefined;

    if (filePath) {
      lines.push(`✓ Saved: ${filePath}`);
    }

    if (resultObj.bytes_written !== undefined) {
      const bytes = Number(resultObj.bytes_written);
      const totalLines =
        resultObj.total_lines !== undefined ? Number(resultObj.total_lines) : 0;
      lines.push(
        `  Size: ${bytes.toLocaleString()} bytes (${totalLines} lines)`,
      );
    }

    if (resultObj.preview) {
      lines.push('');
      lines.push('  Preview:');
      lines.push(
        '  ┌────────────────────────────────────────────────────────────',
      );
      const previewLines = String(resultObj.preview).split('\n');
      previewLines.forEach((line) => {
        lines.push(`  │ ${line}`);
      });
      lines.push(
        '  └────────────────────────────────────────────────────────────',
      );
    }

    return lines.join('\n');
  }

  // For simple status results
  if (resultObj.status === 'success' && resultObj.message) {
    return String(resultObj.message);
  }

  // Default: JSON output (truncated for very large results)
  const jsonStr = JSON.stringify(result, null, 2);
  if (jsonStr.length > 1000) {
    return `${jsonStr.substring(0, 1000)}\n... (truncated)`;
  }
  return jsonStr;
}
