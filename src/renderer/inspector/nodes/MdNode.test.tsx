/**
 * MdNode — renders markdown artifacts (plot, story, world_style,
 * scene_video_prompt).
 *
 * Stage: full markdown body with a fade mask at the bottom when the
 *        content overflows. v1 renders as plain text in a styled
 *        block — react-markdown is bigger than the canvas needs at
 *        zoomed-out levels. Future: optional rich rendering at full
 *        zoom.
 *
 * Tile:  first line of the markdown (or first paragraph), truncated.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { MdNodeStage, MdNodeTile } from './MdNode';

jest.mock('../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ projectDirectory: '/tmp/p' }),
}));

const readFileMock = jest.fn<Promise<string | null>, [string]>();
beforeAll(() => {
  (window as unknown as { electron: unknown }).electron = {
    project: { readFile: (p: string) => readFileMock(p) },
  };
});
beforeEach(() => {
  readFileMock.mockReset();
});

describe('MdNodeStage', () => {
  it('renders pending state when no outputPath', () => {
    render(<MdNodeStage />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('renders the markdown body', async () => {
    readFileMock.mockResolvedValue('A bus hisses to a stop. Ruby steps off.');
    render(<MdNodeStage outputPath="plans/plot.md" />);
    await waitFor(() => {
      expect(screen.getByText(/Ruby steps off/)).toBeInTheDocument();
    });
  });

  it('handles empty file gracefully (no crash, empty body)', async () => {
    readFileMock.mockResolvedValue('');
    render(<MdNodeStage outputPath="plans/empty.md" />);
    await waitFor(() => {
      expect(screen.getByTestId('md-stage-body')).toBeInTheDocument();
    });
    expect(screen.getByTestId('md-stage-body')).toHaveTextContent('');
  });

  it('handles missing file (read returns null)', async () => {
    readFileMock.mockResolvedValue(null);
    render(<MdNodeStage outputPath="plans/gone.md" />);
    await waitFor(() => {
      expect(screen.getByText(/file missing/i)).toBeInTheDocument();
    });
  });

  it('shows the full body even when long (overflow handled by CSS fade)', async () => {
    const long = 'Lorem ipsum '.repeat(200);
    readFileMock.mockResolvedValue(long);
    render(<MdNodeStage outputPath="plans/long.md" />);
    await waitFor(() => {
      expect(screen.getByTestId('md-stage-body')).toHaveTextContent(/Lorem ipsum/);
    });
  });
});

describe('MdNodeTile', () => {
  it('shows the itemId label', () => {
    render(<MdNodeTile itemId="scene_1" status="pending" />);
    expect(screen.getByText('scene_1')).toBeInTheDocument();
  });

  it('renders the first line / paragraph of the markdown, truncated', async () => {
    readFileMock.mockResolvedValue(
      'Slow tracking sequence — depot arrival, Hayes intercepts.\n\nMore detail below.',
    );
    render(
      <MdNodeTile outputPath="prompts/scene_1.md" itemId="scene_1" status="completed" />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Slow tracking sequence/)).toBeInTheDocument();
    });
  });

  it('renders a pending tile with no body when no outputPath', () => {
    render(<MdNodeTile itemId="scene_2" status="pending" />);
    expect(screen.getByText('scene_2')).toBeInTheDocument();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('surfaces failed status via data attribute', () => {
    render(<MdNodeTile itemId="scene_3" status="failed" />);
    expect(screen.getByTestId('md-tile')).toHaveAttribute('data-status', 'failed');
  });
});
