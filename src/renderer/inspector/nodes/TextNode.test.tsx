/**
 * TextNode — renders plain-text artifacts (e.g. original_input).
 *
 * Mirrors MdNode but renders monospace + no fade mask (plain text
 * doesn't get visually clipped at a soft edge).
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { TextNodeStage, TextNodeTile } from './TextNode';

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

describe('TextNodeStage', () => {
  it('renders pending when no outputPath', () => {
    render(<TextNodeStage />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
  });

  it('renders the text body', async () => {
    readFileMock.mockResolvedValue('Ruby V4 — a heist gone bad.');
    render(<TextNodeStage outputPath="inputs/ruby_v4.md" />);
    await waitFor(() => {
      expect(screen.getByText(/Ruby V4 — a heist gone bad/)).toBeInTheDocument();
    });
  });

  it('renders empty body without crashing', async () => {
    readFileMock.mockResolvedValue('');
    render(<TextNodeStage outputPath="inputs/empty.txt" />);
    await waitFor(() => {
      expect(screen.getByTestId('text-stage-body')).toBeInTheDocument();
    });
  });

  it('handles missing file', async () => {
    readFileMock.mockResolvedValue(null);
    render(<TextNodeStage outputPath="inputs/gone.txt" />);
    await waitFor(() => {
      expect(screen.getByText(/file missing/i)).toBeInTheDocument();
    });
  });
});

describe('TextNodeTile', () => {
  it('shows the itemId label', () => {
    render(<TextNodeTile itemId="input_1" status="pending" />);
    expect(screen.getByText('input_1')).toBeInTheDocument();
  });

  it('renders the first line truncated', async () => {
    readFileMock.mockResolvedValue('First line of the text.\nSecond line.');
    render(<TextNodeTile outputPath="inputs/a.txt" itemId="a" status="completed" />);
    await waitFor(() => {
      expect(screen.getByText(/First line of the text/)).toBeInTheDocument();
    });
  });
});
