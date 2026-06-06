import { useMemo, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../types/chat';
import MessageBubble from '../MessageBubble';
import styles from './MessageList.module.scss';

/* eslint-disable react/require-default-props */
interface MessageListProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  showThinkingPlaceholder?: boolean;
  thinkingPlaceholderText?: string;
  thinkingAgentName?: string;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}
/* eslint-enable react/require-default-props */

// Phase display names mapping
const PHASE_DISPLAY_NAMES: Record<string, string> = {
  transcript_input: 'Transcript Input',
  content_planning: 'Planning',
  planning: 'Planning',
  image_placement: 'Image Placement',
  image_generation: 'Image Generation',
  video_placement: 'Video Placement',
  video_generation: 'Video Generation',
  video_replacement: 'Video Replacement',
  video_combine: 'Video Combine',
  completed: 'Completed',
};

export const AUTO_FOLLOW_BOTTOM_THRESHOLD_PX = 96;

export function isViewportNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = AUTO_FOLLOW_BOTTOM_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function deriveScrollFollowState(params: {
  scrollTop: number;
  previousScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  isAutoFollowEnabled: boolean;
  hasUnreadBelow: boolean;
}): {
  isAutoFollowEnabled: boolean;
  hasUnreadBelow: boolean;
} {
  const isNearBottom = isViewportNearBottom(
    params.scrollTop,
    params.scrollHeight,
    params.clientHeight,
  );
  const isScrollingUp = params.scrollTop < params.previousScrollTop;

  if (isNearBottom) {
    return {
      isAutoFollowEnabled: true,
      hasUnreadBelow: false,
    };
  }

  if (isScrollingUp) {
    return {
      isAutoFollowEnabled: false,
      hasUnreadBelow: params.hasUnreadBelow,
    };
  }

  return {
    isAutoFollowEnabled: params.isAutoFollowEnabled,
    hasUnreadBelow: params.hasUnreadBelow,
  };
}

export function deriveContentArrivalState(params: {
  isAutoFollowEnabled: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): {
  isAutoFollowEnabled: boolean;
  hasUnreadBelow: boolean;
} {
  const isNearBottom = isViewportNearBottom(
    params.scrollTop,
    params.scrollHeight,
    params.clientHeight,
  );

  if (params.isAutoFollowEnabled || isNearBottom) {
    return {
      isAutoFollowEnabled: true,
      hasUnreadBelow: false,
    };
  }

  return {
    isAutoFollowEnabled: false,
    hasUnreadBelow: true,
  };
}

// Extract phase transition info from message
function extractPhaseTransition(message: ChatMessage): {
  fromPhase?: string;
  toPhase?: string;
  displayName?: string;
} | null {
  // Check tool_call messages for phase transitions
  if (message.type === 'tool_call' && message.meta) {
    const toolName = message.meta.toolName as string;
    const result = message.meta.result as Record<string, unknown> | undefined;

    // Check for update_project with transition_phase
    if (toolName === 'update_project' && result) {
      const action = (result.action as string) || '';
      const args = message.meta.args as Record<string, unknown> | undefined;

      // Check if this is a transition_phase action
      if (
        action === 'transition_phase' ||
        (args && args.action === 'transition_phase')
      ) {
        // Check result for nextPhase
        if (result.nextPhase) {
          const nextPhase = result.nextPhase as string;
          return {
            toPhase: nextPhase,
            displayName: PHASE_DISPLAY_NAMES[nextPhase] || nextPhase,
          };
        }
        // Also check if result indicates transition happened
        if (result.transitioned === true && result.currentPhase) {
          const currentPhase = result.currentPhase as string;
          return {
            toPhase: currentPhase,
            displayName: PHASE_DISPLAY_NAMES[currentPhase] || currentPhase,
          };
        }
      }
    }
  }

  // Check message content for phase transition mentions
  if (message.content) {
    // Check for "Phase transition successful" pattern from backend
    const successMatch = message.content.match(
      /Phase transition successful.*?in the\s+([\w\s]+?)\s+phase/i,
    );
    if (successMatch) {
      const phaseName = successMatch[1]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      return {
        toPhase: phaseName,
        displayName: PHASE_DISPLAY_NAMES[phaseName] || successMatch[1].trim(),
      };
    }

    // Check for "transitioned from X to Y" pattern
    const transitionMatch = message.content.match(
      /transitioned?\s+from\s+(\w+)\s+to\s+(\w+)/i,
    );
    if (transitionMatch) {
      const toPhase = transitionMatch[2];
      return {
        fromPhase: transitionMatch[1],
        toPhase,
        displayName: PHASE_DISPLAY_NAMES[toPhase] || toPhase,
      };
    }

    // Check for "transitioned to" pattern
    const toMatch = message.content.match(
      /transitioned?\s+to\s+(?:the\s+)?(\w+(?:_\w+)*)\s+phase/i,
    );
    if (toMatch) {
      const toPhase = toMatch[1];
      return {
        toPhase,
        displayName: PHASE_DISPLAY_NAMES[toPhase] || toPhase,
      };
    }

    // Check for phase name in parentheses (common in backend messages)
    const phaseInParens = message.content.match(/\((\w+(?:_\w+)*)\)/i);
    if (phaseInParens && PHASE_DISPLAY_NAMES[phaseInParens[1]]) {
      const toPhase = phaseInParens[1];
      // Only show if message mentions transition
      if (
        message.content.toLowerCase().includes('transition') ||
        message.content.toLowerCase().includes('phase')
      ) {
        return {
          toPhase,
          displayName: PHASE_DISPLAY_NAMES[toPhase] || toPhase,
        };
      }
    }
  }

  return null;
}

export default function MessageList({
  messages,
  isStreaming = false,
  showThinkingPlaceholder = false,
  thinkingPlaceholderText = 'Thinking through the next steps...',
  thinkingAgentName = 'Dhee',
  onRegenerate = undefined,
  onDelete = undefined,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);
  const lastContentVersionRef = useRef<string | null>(null);
  const [isAutoFollowEnabled, setIsAutoFollowEnabled] = useState(true);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);

  const items = useMemo(() => messages, [messages]);
  const contentVersion = useMemo(
    () =>
      [
        items.length,
        items[items.length - 1]?.id || 'none',
        items[items.length - 1]?.content.length || 0,
      ].join(':'),
    [items],
  );

  const scrollToBottom = (behavior: 'auto' | 'smooth' = 'auto') => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
    lastScrollTopRef.current = container.scrollHeight;
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const previousVersion = lastContentVersionRef.current;
    lastContentVersionRef.current = contentVersion;

    if (previousVersion === null) {
      scrollToBottom('auto');
      setHasUnreadBelow(false);
      return;
    }

    if (previousVersion === contentVersion) {
      return;
    }

    const nextState = deriveContentArrivalState({
      isAutoFollowEnabled,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    });

    if (nextState.isAutoFollowEnabled) {
      scrollToBottom('auto');
      setHasUnreadBelow(false);
      return;
    }

    setHasUnreadBelow(nextState.hasUnreadBelow);
  }, [contentVersion, isAutoFollowEnabled]);

  // Check if user has scrolled up
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const nextState = deriveScrollFollowState({
        scrollTop,
        previousScrollTop: lastScrollTopRef.current,
        scrollHeight,
        clientHeight,
        isAutoFollowEnabled,
        hasUnreadBelow,
      });
      setIsAutoFollowEnabled(nextState.isAutoFollowEnabled);
      setHasUnreadBelow(nextState.hasUnreadBelow);
      lastScrollTopRef.current = scrollTop;
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [hasUnreadBelow, isAutoFollowEnabled]);

  // Track last phase to detect transitions
  const lastPhaseRef = useRef<string | null>(null);

  const handleResumeAutoFollow = () => {
    setIsAutoFollowEnabled(true);
    setHasUnreadBelow(false);
    scrollToBottom('smooth');
  };

  return (
    <div className={styles.container}>
      {items.length === 0 && (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>Start your storyboard</h3>
          <p className={styles.emptyDescription}>
            Describe your idea, mention characters, or paste a brief. I&apos;ll
            plan scenes, generate prompts, and coordinate your LLM +
            ComfyUI.
          </p>
        </div>
      )}
      <div
        ref={containerRef}
        className={styles.messages}
        data-testid="message-list-scroll-container"
      >
        {items.map((message) => {
          // Check for phase transition
          const phaseTransition = extractPhaseTransition(message);
          const showPhaseBanner =
            phaseTransition &&
            phaseTransition.toPhase &&
            phaseTransition.toPhase !== lastPhaseRef.current;

          if (showPhaseBanner) {
            lastPhaseRef.current = phaseTransition.toPhase || null;
          }

          return (
            <div key={message.id}>
              {showPhaseBanner && phaseTransition.displayName && (
                <div className={styles.phaseBanner}>
                  <div className={styles.phaseBannerContent}>
                    <span className={styles.phaseIcon}>📍</span>
                    <span className={styles.phaseName}>
                      {phaseTransition.displayName} Phase
                    </span>
                  </div>
                </div>
              )}
              <MessageBubble
                message={message}
                isStreaming={
                  isStreaming &&
                  message.role === 'assistant' &&
                  message.id === items[items.length - 1]?.id
                }
                onRegenerate={
                  onRegenerate ? () => onRegenerate(message.id) : undefined
                }
                onDelete={onDelete ? () => onDelete(message.id) : undefined}
              />
            </div>
          );
        })}
        {showThinkingPlaceholder && (
          <div
            className={styles.thinkingInline}
            aria-live="polite"
            aria-label={`${thinkingAgentName} is thinking`}
          >
            <span className={styles.thinkingInlineAgent}>
              [{thinkingAgentName}]
            </span>{' '}
            <span className={styles.thinkingInlineText}>
              {thinkingPlaceholderText}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {!isAutoFollowEnabled && hasUnreadBelow && (
        <button
          type="button"
          className={styles.resumeButton}
          onClick={handleResumeAutoFollow}
        >
          <span className={styles.resumeButtonIcon}>↓</span>
          <span>New messages</span>
        </button>
      )}
    </div>
  );
}
