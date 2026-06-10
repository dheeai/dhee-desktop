/**
 * AgentContext - Allows components to trigger agent tasks (e.g. "Generate scene videos")
 * without going through the chat input. ChatPanel registers its sendMessage as the implementation.
 *
 * Also surfaces a `notifyChatReceipt(text)` channel: a one-way path to
 * append a system-style bubble in the chat history WITHOUT engaging the
 * agent. Used by the Prompts-tab edit flow to show the user "you edited
 * + invalidated Shot X" right after they save. The agent doesn't see
 * this — disk state (the rewritten prompt + the freshly-pending node)
 * is the source of truth on the next run.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
} from 'react';

type SendTaskFn = (task: string) => Promise<void>;
type NotifyChatReceiptFn = (text: string) => void;
type InvalidateNodesFn = (nodeIds: string[]) => Promise<{
  ok: boolean;
  invalidated?: string[];
  notFound?: string[];
  error?: string;
}>;

interface AgentContextValue {
  sendTask: (task: string) => Promise<void>;
  registerSendTask: (fn: SendTaskFn) => () => void;
  notifyChatReceipt: (text: string) => void;
  registerNotifyChatReceipt: (fn: NotifyChatReceiptFn) => () => void;
  invalidateNodes: InvalidateNodesFn;
  registerInvalidateNodes: (fn: InvalidateNodesFn) => () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const sendTaskRef = useRef<SendTaskFn | null>(null);
  const notifyChatReceiptRef = useRef<NotifyChatReceiptFn | null>(null);
  const invalidateNodesRef = useRef<InvalidateNodesFn | null>(null);

  const registerSendTask = useCallback((fn: SendTaskFn) => {
    sendTaskRef.current = fn;
    return () => {
      sendTaskRef.current = null;
    };
  }, []);

  const registerNotifyChatReceipt = useCallback(
    (fn: NotifyChatReceiptFn) => {
      notifyChatReceiptRef.current = fn;
      return () => {
        notifyChatReceiptRef.current = null;
      };
    },
    [],
  );

  const sendTask = useCallback(async (task: string) => {
    if (sendTaskRef.current) {
      await sendTaskRef.current(task);
    } else {
      console.warn('[AgentContext] No sendTask registered (ChatPanel may not be mounted)');
    }
  }, []);

  const notifyChatReceipt = useCallback((text: string) => {
    if (notifyChatReceiptRef.current) {
      notifyChatReceiptRef.current(text);
    } else {
      console.warn(
        '[AgentContext] No notifyChatReceipt registered (ChatPanel may not be mounted)',
      );
    }
  }, []);

  const registerInvalidateNodes = useCallback((fn: InvalidateNodesFn) => {
    invalidateNodesRef.current = fn;
    return () => {
      invalidateNodesRef.current = null;
    };
  }, []);

  const invalidateNodes = useCallback<InvalidateNodesFn>(
    async (nodeIds) => {
      if (invalidateNodesRef.current) {
        return invalidateNodesRef.current(nodeIds);
      }
      return {
        ok: false,
        error: 'invalidateNodes not registered (chat panel must be mounted)',
      };
    },
    [],
  );

  const value: AgentContextValue = {
    sendTask,
    registerSendTask,
    notifyChatReceipt,
    registerNotifyChatReceipt,
    invalidateNodes,
    registerInvalidateNodes,
  };
  return (
    <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
  );
}

export function useAgent(): AgentContextValue | null {
  return useContext(AgentContext);
}
