/**
 * Inspector action callbacks. Lifted into a React context so any
 * nested node / tile can reach them without prop drilling through
 * the React Flow node registry.
 *
 * Currently:
 *   - onGoalClick(nodeId)  — fired when the user clicks the bundle's
 *                            declared goal node. PreviewPanel uses
 *                            this to deep-link to the Watch tab.
 */
import { createContext, useContext } from 'react';

export interface InspectorActions {
  onGoalClick?: (nodeId: string) => void;
}

export const InspectorActionContext = createContext<InspectorActions>({});

export function useInspectorActions(): InspectorActions {
  return useContext(InspectorActionContext);
}
