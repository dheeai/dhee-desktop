/**
 * usePlaybackController - Production-grade playback control hook
 * Combines TimeIndex and PlaybackStateMachine for reliable scene transitions
 * Single source of truth for what should be playing at any given time
 */

import { useMemo, useRef, useEffect } from 'react';
import type { TimelineItem } from './useTimelineData';
import { TimeIndex } from '../utils/TimeIndex';
import {
  PlaybackStateMachine,
  type PlaybackState,
} from '../utils/PlaybackStateMachine';

export interface PlaybackControllerResult {
  currentItem: TimelineItem | null;
  currentItemIndex: number | null;
  playbackState: PlaybackState;
  timeIndex: TimeIndex;
}

export function usePlaybackController(
  timelineItems: TimelineItem[],
  playbackTime: number,
  isPlaying: boolean,
  isDragging: boolean,
  isSeeking: boolean | (() => boolean),
): PlaybackControllerResult {
  // Build time index when timeline items change
  const timeIndex = useMemo(() => {
    if (timelineItems.length === 0) {
      // Return a dummy index for empty timeline
      return new TimeIndex([]);
    }
    return new TimeIndex(timelineItems);
  }, [timelineItems]);

  // State machine instance - use ref to persist across renders
  const stateMachineRef = useRef<PlaybackStateMachine | null>(null);
  if (!stateMachineRef.current) {
    stateMachineRef.current = new PlaybackStateMachine(timeIndex);
  }

  // Update state machine reference when timeIndex changes
  useEffect(() => {
    stateMachineRef.current = new PlaybackStateMachine(timeIndex);
  }, [timeIndex]);

  // Update state machine on playback time changes
  // Get seeking state inside useMemo to avoid calling function during render
  const playbackState = useMemo<PlaybackState>(() => {
    if (isDragging) {
      // Don't update during drag - return current state
      return stateMachineRef.current?.getCurrentState() ?? { type: 'IDLE' };
    }

    if (!stateMachineRef.current) {
      return { type: 'IDLE' };
    }

    // Get current seeking state (handle both boolean and function)
    // Call function here, not during render
    const currentIsSeeking =
      typeof isSeeking === 'function' ? isSeeking() : isSeeking;

    return stateMachineRef.current.update(
      playbackTime,
      isPlaying,
      currentIsSeeking,
    );
  }, [playbackTime, isPlaying, isSeeking, isDragging]);

  // Get current item from state
  const currentItem = useMemo(() => {
    return playbackState.type === 'PLAYING' || playbackState.type === 'PAUSED'
      ? playbackState.item
      : null;
  }, [playbackState]);

  const currentItemIndex = useMemo(() => {
    return playbackState.type === 'PLAYING' || playbackState.type === 'PAUSED'
      ? playbackState.itemIndex
      : null;
  }, [playbackState]);

  return {
    currentItem,
    currentItemIndex,
    playbackState,
    timeIndex,
  };
}
