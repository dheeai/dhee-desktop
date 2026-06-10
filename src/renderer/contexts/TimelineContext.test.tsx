import '@testing-library/jest-dom';
import { act, render, renderHook, screen } from '@testing-library/react';
import { TimelineProvider, useTimeline } from './TimelineContext';
import type { ProjectState, StoryboardScene } from '../types/projectState';

/**
 * Covers TimelineContext's two isolable concerns:
 *  - scene selection state machine (single / multi-toggle / shift-range) and
 *    drag bookkeeping — pure React state, no deps.
 *  - reorderScenes: the array splice + scene-number renumber + artifact
 *    remap, which persists via window.electron.project.writeFile (the only dep).
 */

function wrapper({ children }: { children: React.ReactNode }) {
  return <TimelineProvider>{children}</TimelineProvider>;
}

describe('TimelineContext — selection state machine', () => {
  it('throws if used outside the provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTimeline())).toThrow(
      /must be used within TimelineProvider/,
    );
    spy.mockRestore();
  });

  it('single-select replaces the selection', () => {
    const { result } = renderHook(() => useTimeline(), { wrapper });
    act(() => result.current.selectScene(2));
    expect([...result.current.selectedScenes]).toEqual([2]);
    act(() => result.current.selectScene(5));
    expect([...result.current.selectedScenes]).toEqual([5]);
  });

  it('multi-select toggles a scene in/out of the set', () => {
    const { result } = renderHook(() => useTimeline(), { wrapper });
    act(() => result.current.selectScene(1));
    act(() => result.current.selectScene(3, true));
    expect([...result.current.selectedScenes].sort()).toEqual([1, 3]);
    // toggling 3 again removes it
    act(() => result.current.selectScene(3, true));
    expect([...result.current.selectedScenes]).toEqual([1]);
  });

  it('range-select fills the inclusive span from the last selected scene', () => {
    const { result } = renderHook(() => useTimeline(), { wrapper });
    act(() => result.current.selectScene(2)); // anchor
    act(() => result.current.selectScene(5, false, true)); // range 2..5
    expect([...result.current.selectedScenes].sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5,
    ]);
  });

  it('clearSelection empties the set', () => {
    const { result } = renderHook(() => useTimeline(), { wrapper });
    act(() => result.current.selectScene(4, true));
    act(() => result.current.clearSelection());
    expect(result.current.selectedScenes.size).toBe(0);
  });

  it('tracks drag start/drop-index/end', () => {
    const { result } = renderHook(() => useTimeline(), { wrapper });
    act(() => result.current.startDrag(7));
    expect(result.current.draggedSceneNumber).toBe(7);
    act(() => result.current.setDropIndex(2));
    expect(result.current.dropInsertIndex).toBe(2);
    act(() => result.current.endDrag());
    expect(result.current.draggedSceneNumber).toBeNull();
    expect(result.current.dropInsertIndex).toBeNull();
  });
});

function scene(n: number): StoryboardScene {
  return { scene_number: n, description: `scene ${n}` };
}

function projectStateWith(sceneNums: number[]): ProjectState {
  return {
    project_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    phase: 'storyboard',
    storyboard_outline: {
      scenes: sceneNums.map(scene),
      total_scenes: sceneNums.length,
    },
    characters: {},
    locations: {},
    artifacts: [
      {
        artifact_id: 'a-for-3',
        artifact_type: 'image',
        file_path: '/img3.png',
        scene_number: 3,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    character_assets: {},
    setting_assets: {},
    character_details: {},
  };
}

describe('TimelineContext — reorderScenes', () => {
  let writeFile: jest.Mock;

  beforeEach(() => {
    writeFile = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { project: { writeFile } },
    });
  });

  it('moves a scene, renumbers sequentially, remaps artifacts, and persists', async () => {
    const { result } = renderHook(() => useTimeline(), { wrapper });
    const onStateUpdate =
      jest.fn();
    const initial = projectStateWith([1, 2, 3]);

    // Move scene 3 to the front (insertIndex 0).
    await act(async () => {
      await result.current.reorderScenes(3, 0, initial, '/proj', onStateUpdate);
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, json] = writeFile.mock.calls[0]!;
    expect(path).toBe('/proj/.dhee/project.json');

    const written = JSON.parse(json as string) as ProjectState;
    // Order is now [old3, old1, old2] renumbered 1,2,3.
    expect(written.storyboard_outline!.scenes.map((s) => s.description)).toEqual(
      ['scene 3', 'scene 1', 'scene 2'],
    );
    expect(written.storyboard_outline!.scenes.map((s) => s.scene_number)).toEqual(
      [1, 2, 3],
    );
    expect(written.storyboard_outline!.total_scenes).toBe(3);
    // The artifact that pointed at old scene 3 now points at new position 1.
    expect(written.artifacts[0]!.scene_number).toBe(1);

    expect(onStateUpdate).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when dragging a scene to its own position', async () => {
    const { result } = renderHook(() => useTimeline(), { wrapper });
    const onStateUpdate = jest.fn();

    await act(async () => {
      await result.current.reorderScenes(
        2,
        1, // scene 2 is already at index 1
        projectStateWith([1, 2, 3]),
        '/proj',
        onStateUpdate,
      );
    });

    expect(writeFile).not.toHaveBeenCalled();
    expect(onStateUpdate).not.toHaveBeenCalled();
  });

  it('bails out when project state or directory is missing', async () => {
    const { result } = renderHook(() => useTimeline(), { wrapper });
    const onStateUpdate = jest.fn();

    await act(async () => {
      await result.current.reorderScenes(1, 0, null, '/proj', onStateUpdate);
      await result.current.reorderScenes(
        1,
        0,
        projectStateWith([1, 2]),
        null,
        onStateUpdate,
      );
    });

    expect(writeFile).not.toHaveBeenCalled();
    expect(onStateUpdate).not.toHaveBeenCalled();
  });

  it('exposes context to a real consumer component via the provider', () => {
    function Consumer() {
      const { selectedScenes, selectScene } = useTimeline();
      return (
        <button type="button" onClick={() => selectScene(9)}>
          sel:{[...selectedScenes].join(',')}
        </button>
      );
    }
    render(
      <TimelineProvider>
        <Consumer />
      </TimelineProvider>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('sel:');
    act(() => btn.click());
    expect(btn).toHaveTextContent('sel:9');
  });
});
