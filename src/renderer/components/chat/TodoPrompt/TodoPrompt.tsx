import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ListTodo, LoaderCircle } from 'lucide-react';
import type { TodoItem, TodoStatus } from '../TodoDisplay';
import styles from './TodoPrompt.module.scss';

export interface TodoPromptProps {
  todos: TodoItem[];
  isRunning?: boolean;
}

const STATUS_SYMBOLS: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '→',
  completed: '✓',
  cancelled: '✗',
};

export default function TodoPrompt({
  todos,
  isRunning = false,
}: TodoPromptProps) {
  const [collapsed, setCollapsed] = useState(true);

  const visibleTodos = useMemo(
    () => todos.filter((todo) => todo.task || todo.content),
    [todos],
  );

  useEffect(() => {
    if (visibleTodos.length <= 3) {
      setCollapsed(false);
    }
  }, [visibleTodos.length]);

  const completedCount = visibleTodos.filter(
    (todo) => todo.status === 'completed',
  ).length;
  const inProgressTodo = visibleTodos.find(
    (todo) => todo.status === 'in_progress',
  );
  const pendingCount = visibleTodos.filter(
    (todo) => (todo.status || 'pending') === 'pending',
  ).length;
  const totalCount = visibleTodos.length;
  const progressLabel = `${completedCount}/${totalCount}`;
  const currentTask =
    inProgressTodo?.task ||
    inProgressTodo?.content ||
    (pendingCount > 0 ? 'Waiting for next task' : 'Run complete');

  if (visibleTodos.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.summaryBar}
        onClick={() => setCollapsed((value) => !value)}
      >
        <div className={styles.summaryMain}>
          <div className={styles.summaryTitle}>
            <ListTodo className={styles.icon} />
            <span>Task Progress</span>
          </div>
          <div className={styles.summaryMeta}>
            <span className={styles.progressBadge}>{progressLabel}</span>
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </div>
        </div>
        <div className={styles.summaryText}>
          {inProgressTodo && isRunning && (
            <LoaderCircle size={13} className={styles.spinner} />
          )}
          <span>{currentTask}</span>
        </div>
      </button>

      {!collapsed && (
        <div className={styles.todoList}>
          {visibleTodos.map((todo, index) => {
            const status = (todo.status || 'pending') as TodoStatus;
            const content = todo.task || todo.content || 'Task';
            const depth = todo.depth || 0;

            return (
              <div
                key={todo.id || `${content}-${index}`}
                className={styles.todoItem}
              >
                <span className={styles.todoIndent}>{'  '.repeat(depth)}</span>
                <span className={styles[`status${status}`]}>
                  {STATUS_SYMBOLS[status]}
                </span>
                <span
                  className={
                    status === 'pending' || status === 'cancelled'
                      ? styles.todoContentDimmed
                      : styles.todoContent
                  }
                >
                  {content}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

TodoPrompt.defaultProps = {
  isRunning: false,
};
