import { createContext, useContext, type ReactNode } from 'react';
import {
  useTimelineData,
  type TimelineDataWithRefresh,
} from '../hooks/useTimelineData';
import type { SceneVersions } from '../types/dhee/timeline';

export type TimelineDataContextType = TimelineDataWithRefresh;

const TimelineDataContext = createContext<TimelineDataContextType | null>(null);

interface TimelineDataProviderProps {
  activeVersions?: Record<number, SceneVersions>;
  children: ReactNode;
}

/**
 * Single source of truth for timeline data (placement items, audio, total duration).
 * Both TimelinePanel and VideoLibraryView consume from this context so they
 * always see the same data after import or file changes.
 */
export function TimelineDataProvider({
  activeVersions = {},
  children,
}: TimelineDataProviderProps) {
  const value = useTimelineData(activeVersions);

  return (
    <TimelineDataContext.Provider value={value}>
      {children}
    </TimelineDataContext.Provider>
  );
}

export function useTimelineDataContext(): TimelineDataContextType {
  const context = useContext(TimelineDataContext);
  if (!context) {
    throw new Error(
      'useTimelineDataContext must be used within TimelineDataProvider',
    );
  }
  return context;
}
