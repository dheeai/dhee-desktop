import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ChatMessage } from '../../../types/chat';
import CodeBlock from '../CodeBlock';
import MessageActions from '../MessageActions';
import ToolCallCard from '../ToolCallCard';
import TodoDisplay from '../TodoDisplay';
import type { TodoItem } from '../TodoDisplay';
import SceneCard, {
  isDuplicateSceneSummary,
  parseSceneContent,
} from '../SceneCard';
import styles from './MessageBubble.module.scss';
import { useWorkspace } from '../../../contexts/WorkspaceContext';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onDelete?: () => void;
}

const roleLabels: Record<ChatMessage['role'], string> = {
  user: 'You',
  assistant: 'Dhee',
  system: 'System',
};

const formatter = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

// Character limit for truncating user messages
const USER_MESSAGE_TRUNCATE_LIMIT = 150;

const MarkdownComponents = {
  code({ inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const codeString = String(children).replace(/\n$/, '');

    return !inline && match ? (
      <CodeBlock code={codeString} language={language} />
    ) : (
      <code className={styles.inlineCode} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children }: any) {
    return (
      <a
        href={href}
        className={styles.link}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  h1: ({ children }: any) => <h1 className={styles.heading1}>{children}</h1>,
  h2: ({ children }: any) => <h2 className={styles.heading2}>{children}</h2>,
  h3: ({ children }: any) => <h3 className={styles.heading3}>{children}</h3>,
  ul: ({ children }: any) => <ul className={styles.list}>{children}</ul>,
  ol: ({ children }: any) => <ol className={styles.list}>{children}</ol>,
  blockquote: ({ children }: any) => (
    <blockquote className={styles.blockquote}>{children}</blockquote>
  ),
};

export default function MessageBubble({
  message,
  isStreaming = false,
  onRegenerate,
  onDelete,
}: MessageBubbleProps) {
  const [remarkGfm, setRemarkGfm] = useState<any>(null);

  useEffect(() => {
    import('remark-gfm')
      .then((mod) => {
        setRemarkGfm(() => mod.default);
        return null;
      })
      .catch((err) => {
        console.error('Failed to load remark-gfm', err);
      });
  }, []);

  const isIntermediate = ['tool_call', 'progress', 'status'].includes(
    message.type,
  );
  const isError = message.type === 'error';
  const isSystem = message.role === 'system';
  const isToolCall = message.type === 'tool_call';
  const isTodoUpdate = message.type === 'todo_update';
  const isGreeting = message.type === 'greeting';

  // Get navigateToFile from context
  const { navigateToFile } = useWorkspace();

  // Render tool call card
  if (isToolCall && message.meta) {
    const toolName = (message.meta.toolName as string) || 'tool';
    const status = (message.meta.status as string) || 'executing';
    const args = (message.meta.args as Record<string, unknown>) || {};
    const { result } = message.meta;
    const duration = message.meta.duration as number | undefined;
    const streamingContent = message.meta.streamingContent as
      | string
      | undefined;

    return (
      <div className={`${styles.container} ${styles.system}`}>
        <ToolCallCard
          toolName={toolName}
          agentName={message.author} // Pass agent name if available
          args={args}
          status={
            status as 'executing' | 'completed' | 'error' | 'needs_confirmation'
          }
          result={result}
          duration={duration}
          toolCallId={message.meta.toolCallId as string | undefined}
          streamingContent={streamingContent}
          onFileClick={navigateToFile}
        />
      </div>
    );
  }

  // Render todo display
  if (isTodoUpdate && message.meta?.todos) {
    const todos = message.meta.todos as TodoItem[];
    return (
      <div className={`${styles.container} ${styles.system}`}>
        <TodoDisplay todos={todos} />
      </div>
    );
  }

  // Handle dispatch_agent (plan) messages with markdown
  const isDispatchAgent = message.meta?.toolName === 'dispatch_agent';
  const agentName = message.author;

  // Check if message contains only reasoning (should be collapsible when done)
  // Reasoning messages start with tags like <think>, <think>, etc.
  const contentStart = message.content.trim().substring(0, 100);
  // Check if content starts with a reasoning/thinking tag (case-insensitive check in lowercase)
  const contentStartLower = contentStart.toLowerCase();
  const hasReasoning = contentStartLower.includes('<think');
  // Message is "reasoning only" if it starts with a reasoning tag
  const isReasoningOnly =
    hasReasoning && contentStartLower.trim().startsWith('<think');
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(false);

  // Auto-collapse reasoning messages when done (not streaming)
  useEffect(() => {
    if (isReasoningOnly && !isStreaming) {
      setIsReasoningExpanded(false);
    }
  }, [isReasoningOnly, isStreaming]);

  // Check if user message should be truncated
  const isUserMessage = message.role === 'user';
  const shouldTruncate =
    isUserMessage && message.content.length > USER_MESSAGE_TRUNCATE_LIMIT;
  const [isUserMessageExpanded, setIsUserMessageExpanded] = useState(false);

  // Get truncated content for user messages
  const getTruncatedContent = (content: string) => {
    if (!shouldTruncate) return content;
    return `${content.substring(0, USER_MESSAGE_TRUNCATE_LIMIT)}...`;
  };

  return (
    <div
      className={`${styles.container} ${styles[message.role]} ${
        isStreaming ? styles.streaming : ''
      } ${isIntermediate ? styles.intermediate : ''} ${
        isError ? styles.error : ''
      } ${isGreeting ? styles.greeting : ''}`}
    >
      {!isGreeting && (
        <div className={styles.header}>
          {message.role === 'assistant' && agentName ? (
            <span className={styles.role}>
              <span className={styles.agentName}>[{agentName}]</span>
            </span>
          ) : message.role === 'assistant' ? (
            <span className={styles.role}>
              <span className={styles.agentName}>[Orchestrator]</span>
            </span>
          ) : (
            <span className={styles.role}>{roleLabels[message.role]}</span>
          )}

          {message.type &&
            message.type !== 'message' &&
            message.type !== 'agent_text' &&
            message.type !== 'stream_chunk' && (
              <span className={styles.type}>{message.type}</span>
            )}
          <span className={styles.time}>
            {formatter.format(new Date(message.timestamp))}
          </span>
          {!isSystem && (
            <div className={styles.actions}>
              <MessageActions
                message={message}
                onRegenerate={onRegenerate}
                onDelete={onDelete}
                showRegenerate={message.role === 'assistant' && !isIntermediate}
              />
            </div>
          )}
        </div>
      )}
      <div className={styles.body}>
        {isGreeting ? (
          <div className={styles.greetingContent}>
            <ReactMarkdown
              remarkPlugins={remarkGfm ? [remarkGfm] : []}
              components={MarkdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : isSystem ? (
          <div className={styles.systemContent}>{message.content}</div>
        ) : isDispatchAgent && message.meta?.result ? (
          // Render plan from dispatch_agent result
          <ReactMarkdown
            remarkPlugins={remarkGfm ? [remarkGfm] : []}
            components={MarkdownComponents}
          >
            {((message.meta.result as Record<string, unknown>)
              ?.plan as string) || message.content}
          </ReactMarkdown>
        ) : isReasoningOnly && !isStreaming ? (
          // Collapsible reasoning message when done
          <div className={styles.reasoningContainer}>
            <button
              type="button"
              className={styles.reasoningToggle}
              onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
            >
              {isReasoningExpanded ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
              <span className={styles.reasoningLabel}>
                {isReasoningExpanded ? 'Hide' : 'Show'} thinking
              </span>
            </button>
            {isReasoningExpanded && (
              <div className={styles.reasoningContent}>
                <ReactMarkdown
                  remarkPlugins={remarkGfm ? [remarkGfm] : []}
                  components={MarkdownComponents}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        ) : shouldTruncate ? (
          // Truncated user message with expand/collapse
          <div className={styles.reasoningContainer}>
            {!isUserMessageExpanded ? (
              <>
                <ReactMarkdown
                  remarkPlugins={remarkGfm ? [remarkGfm] : []}
                  components={MarkdownComponents}
                >
                  {getTruncatedContent(message.content)}
                </ReactMarkdown>
                <button
                  type="button"
                  className={styles.reasoningToggle}
                  onClick={() => setIsUserMessageExpanded(true)}
                >
                  <ChevronDown size={16} />
                  <span className={styles.reasoningLabel}>Show more</span>
                </button>
              </>
            ) : (
              <>
                <ReactMarkdown
                  remarkPlugins={remarkGfm ? [remarkGfm] : []}
                  components={MarkdownComponents}
                >
                  {message.content}
                </ReactMarkdown>
                <button
                  type="button"
                  className={styles.reasoningToggle}
                  onClick={() => setIsUserMessageExpanded(false)}
                >
                  <ChevronUp size={16} />
                  <span className={styles.reasoningLabel}>Show less</span>
                </button>
              </>
            )}
          </div>
        ) : (() => {
          // Try to render as a structured scene card when the content embeds scene JSON.
          if (!isStreaming && message.content) {
            const parsedSceneContent = parseSceneContent(message.content);
            if (parsedSceneContent) {
              const shouldHideRemainingText =
                !parsedSceneContent.remainingText ||
                isDuplicateSceneSummary(
                  parsedSceneContent.remainingText,
                  parsedSceneContent.sceneData,
                );

              return (
                <div className={styles.sceneContent}>
                  <SceneCard data={parsedSceneContent.sceneData} />
                  {!shouldHideRemainingText && (
                    <div className={styles.sceneSupplementaryText}>
                      <ReactMarkdown
                        remarkPlugins={remarkGfm ? [remarkGfm] : []}
                        components={MarkdownComponents}
                      >
                        {parsedSceneContent.remainingText}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            }
          }
          return (
            <ReactMarkdown
              remarkPlugins={remarkGfm ? [remarkGfm] : []}
              components={MarkdownComponents}
            >
              {message.content ||
                (message.role === 'assistant' && isStreaming
                  ? '*Thinking...*'
                  : message.content)}
            </ReactMarkdown>
          );
        })()}
      </div>
    </div>
  );
}
