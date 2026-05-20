import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { DheeSessionApi } from '../../../hooks/useDheeSession';

// Hoisted mock state so beforeEach can re-shape the session API
// returned by `useDheeSession`. Done this way (rather than calling
// jest.mock inside each test) so the same module reference satisfies
// the AssetRegenerateButton import.
type RedoNodeFn = DheeSessionApi['redoNode'];
const sessionMock: {
  sessionId: string | null;
  redoNode: jest.Mock<RedoNodeFn>;
} = {
  sessionId: 'test-session-1',
  redoNode: jest.fn<RedoNodeFn>(),
};

jest.mock('../../../hooks/useDheeSession', () => ({
  __esModule: true,
  useDheeSession: (): Partial<DheeSessionApi> => ({
    sessionId: sessionMock.sessionId,
    redoNode: sessionMock.redoNode as unknown as DheeSessionApi['redoNode'],
  }),
}));

// Imported AFTER the mock so the module sees the mocked hook.
import AssetRegenerateButton from './AssetRegenerateButton';

beforeEach(() => {
  sessionMock.sessionId = 'test-session-1';
  sessionMock.redoNode.mockReset();
  sessionMock.redoNode.mockResolvedValue({ ok: true });
});

describe('AssetRegenerateButton — surgical regen payloads', () => {
  it('last_frame regen sends scope=image_only + frame=last_frame to redoNode', async () => {
    render(
      <AssetRegenerateButton
        nodeId="shot_image:scene_2_shot_4"
        scope="image_only"
        frame="last_frame"
        label="Regenerate last frame"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate last frame' }));

    await waitFor(() => {
      expect(sessionMock.redoNode).toHaveBeenCalledWith(
        'shot_image:scene_2_shot_4',
        { scope: 'image_only', frame: 'last_frame' },
      );
    });
  });

  it('first_frame regen sends scope=image_only + frame=first_frame', async () => {
    render(
      <AssetRegenerateButton
        nodeId="shot_image:scene_2_shot_4"
        scope="image_only"
        frame="first_frame"
        label="Regenerate first frame"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate first frame' }));

    await waitFor(() => {
      expect(sessionMock.redoNode).toHaveBeenCalledWith(
        'shot_image:scene_2_shot_4',
        { scope: 'image_only', frame: 'first_frame' },
      );
    });
  });

  it('video regen sends just the nodeId (no scope, no frame)', async () => {
    render(
      <AssetRegenerateButton
        nodeId="shot_video:scene_2_shot_4"
        label="Regenerate video"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate video' }));

    await waitFor(() => {
      expect(sessionMock.redoNode).toHaveBeenCalledWith(
        'shot_video:scene_2_shot_4',
        {},
      );
    });
  });

  it('prompt re-roll sends scope=prompt against the prompt node', async () => {
    render(
      <AssetRegenerateButton
        nodeId="shot_image_prompt:scene_2_shot_4"
        scope="prompt"
        label="Re-roll prompt"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Re-roll prompt' }));

    await waitFor(() => {
      expect(sessionMock.redoNode).toHaveBeenCalledWith(
        'shot_image_prompt:scene_2_shot_4',
        { scope: 'prompt' },
      );
    });
  });

  it('button is disabled when there is no active session', () => {
    sessionMock.sessionId = null;

    render(
      <AssetRegenerateButton
        nodeId="shot_image:scene_2_shot_4"
        scope="image_only"
        frame="last_frame"
        label="Regenerate last frame"
      />,
    );

    const btn = screen.getByRole('button', { name: 'Regenerate last frame' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(btn);
    expect(sessionMock.redoNode).not.toHaveBeenCalled();
  });

  it('respects an external disabled prop', () => {
    render(
      <AssetRegenerateButton
        nodeId="shot_image:scene_2_shot_4"
        scope="image_only"
        frame="first_frame"
        label="Regenerate first frame"
        disabled
      />,
    );

    const btn = screen.getByRole('button', { name: 'Regenerate first frame' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(sessionMock.redoNode).not.toHaveBeenCalled();
  });

  it('surfaces redoNode errors in the title attribute', async () => {
    sessionMock.redoNode.mockResolvedValueOnce({
      ok: false,
      error: 'project not loaded',
    });

    render(
      <AssetRegenerateButton
        nodeId="shot_video:scene_2_shot_4"
        label="Regenerate video"
      />,
    );

    const btn = screen.getByRole('button', { name: 'Regenerate video' });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(btn.getAttribute('title')).toContain('project not loaded');
    });
  });
});
