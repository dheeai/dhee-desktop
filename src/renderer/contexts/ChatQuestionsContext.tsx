/**
 * Generalised "ask a question in the chat panel" mechanism.
 *
 * The chat panel already knows how to render a question banner —
 * a row with prompt text + a set of option buttons — because the
 * pi-agent emits `agent_question` streaming events. Those questions
 * are tied to the agent's turn loop (the answer is shipped back via
 * `session.sendResponse`).
 *
 * This context lets *any* non-agent code (e.g. the "Redo from..."
 * dropdown after it marks nodes pending) post the same kind of
 * question and receive the user's pick as a Promise. The chat panel
 * subscribes to the queue here and renders each entry through the
 * same `QuestionRow` UI used for agent questions, so the experience
 * is uniform — wherever the question came from, the user picks an
 * option in the same place.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ChatQuestion {
  id: string;
  question: string;
  /** Buttons to render. Empty means free-text — not yet supported here. */
  options: string[];
  /** Cosmetic hint for the default. UI doesn't auto-select; the user picks. */
  defaultOption?: string;
}

interface ChatQuestionsContextType {
  pending: ChatQuestion[];
  /**
   * Post a question into the chat. Resolves with the user's pick.
   * If the question is dismissed (e.g. project switch) the promise
   * resolves with `null`.
   */
  askQuestion: (opts: Omit<ChatQuestion, 'id'>) => Promise<string | null>;
  /** Called by the chat panel's QuestionRow when the user clicks an option. */
  resolveQuestion: (id: string, option: string) => void;
}

const ChatQuestionsContext = createContext<ChatQuestionsContextType | null>(null);

let nextQuestionId = 1;
function newQuestionId(): string {
  return `cq-${nextQuestionId++}`;
}

interface ChatQuestionsProviderProps {
  children: ReactNode;
}

export function ChatQuestionsProvider({ children }: ChatQuestionsProviderProps) {
  const [pending, setPending] = useState<ChatQuestion[]>([]);
  // Resolvers live in a ref so re-renders don't reset them and they
  // don't leak into the public API.
  const resolversRef = useRef<Map<string, (option: string | null) => void>>(new Map());

  const askQuestion = useCallback<ChatQuestionsContextType['askQuestion']>(
    (opts) => {
      const id = newQuestionId();
      const entry: ChatQuestion = {
        id,
        question: opts.question,
        options: opts.options,
        defaultOption: opts.defaultOption,
      };
      return new Promise<string | null>((resolve) => {
        resolversRef.current.set(id, resolve);
        setPending((prev) => [...prev, entry]);
      });
    },
    [],
  );

  const resolveQuestion = useCallback<ChatQuestionsContextType['resolveQuestion']>(
    (id, option) => {
      const resolver = resolversRef.current.get(id);
      if (resolver) {
        resolversRef.current.delete(id);
        resolver(option);
      }
      setPending((prev) => prev.filter((q) => q.id !== id));
    },
    [],
  );

  const value = useMemo<ChatQuestionsContextType>(
    () => ({ pending, askQuestion, resolveQuestion }),
    [pending, askQuestion, resolveQuestion],
  );

  return (
    <ChatQuestionsContext.Provider value={value}>
      {children}
    </ChatQuestionsContext.Provider>
  );
}

export function useChatQuestions(): ChatQuestionsContextType {
  const ctx = useContext(ChatQuestionsContext);
  if (!ctx) {
    throw new Error('useChatQuestions must be used within a ChatQuestionsProvider');
  }
  return ctx;
}
