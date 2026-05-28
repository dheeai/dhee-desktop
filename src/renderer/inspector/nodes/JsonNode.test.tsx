/**
 * JsonNode — renders JSON artifacts in the Inspector Canvas.
 *
 * Stage: full JSON tree, with `headlineField` value highlighted at
 *        the top when declared. Falls back to the raw tree when
 *        absent or the dot-path doesn't resolve.
 *
 * Tile (rail-mode): just the `headlineField` value truncated to a
 *                   couple of lines, plus the itemId.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { JsonNodeStage, JsonNodeTile } from './JsonNode';

// Mock the workspace context — useArtifactText reads projectDirectory
// from it.
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

describe('JsonNodeStage', () => {
  it('renders pending state when no outputPath', async () => {
    render(<JsonNodeStage />);
    expect(screen.getByText(/pending|not yet/i)).toBeInTheDocument();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('shows the headlineField value when declared and present in the JSON', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ deltaText: 'Ruby steps off the bus.' }));
    render(<JsonNodeStage outputPath="prompts/s1.json" headlineField="deltaText" />);
    await waitFor(() => {
      expect(screen.getByTestId('json-headline')).toHaveTextContent(/Ruby steps off the bus/i);
    });
  });

  it('renders the full JSON tree below the headline', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ deltaText: 'A wide shot.', view: 'wide', distance: 'far' }),
    );
    render(<JsonNodeStage outputPath="prompts/s1.json" headlineField="deltaText" />);
    await waitFor(() => {
      expect(screen.getByTestId('json-headline')).toHaveTextContent(/A wide shot/);
    });
    // The tree shows every key.
    expect(screen.getByText('view')).toBeInTheDocument();
    expect(screen.getByText('distance')).toBeInTheDocument();
  });

  it('resolves a dot-path headlineField (frames.first_frame.imagePrompt)', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ frames: { first_frame: { imagePrompt: 'Marcus walks in.' } } }),
    );
    render(
      <JsonNodeStage
        outputPath="prompts/s1.json"
        headlineField="frames.first_frame.imagePrompt"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('json-headline')).toHaveTextContent(/Marcus walks in/);
    });
  });

  it('falls back to the tree-only view when headlineField is missing', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ description: 'Some text', mood: 'tense' }));
    render(<JsonNodeStage outputPath="prompts/x.json" />);
    await waitFor(() => {
      expect(screen.getByText(/description/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('json-headline')).toBeNull();
  });

  it('falls back to the tree when headlineField path does not resolve', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ otherField: 'value' }));
    render(<JsonNodeStage outputPath="prompts/x.json" headlineField="deltaText" />);
    await waitFor(() => {
      expect(screen.getByText(/otherField/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('json-headline')).toBeNull();
  });

  it('handles malformed JSON without crashing — shows raw text', async () => {
    readFileMock.mockResolvedValue('{ not valid json');
    render(<JsonNodeStage outputPath="prompts/broken.json" />);
    await waitFor(() => {
      expect(screen.getByText(/not valid json/)).toBeInTheDocument();
    });
  });

  it('handles file-read failure (missing file) gracefully', async () => {
    readFileMock.mockResolvedValue(null);
    render(<JsonNodeStage outputPath="prompts/gone.json" />);
    await waitFor(() => {
      expect(screen.getByText(/file missing|not yet/i)).toBeInTheDocument();
    });
  });
});

describe('JsonNodeTile', () => {
  it('renders the headlineField value (truncated)', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ deltaText: 'A bus hisses to a stop at the depot.' }),
    );
    render(
      <JsonNodeTile
        outputPath="prompts/s1.json"
        headlineField="deltaText"
        itemId="scene_1_shot_1"
        status="completed"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/A bus hisses to a stop/)).toBeInTheDocument();
    });
  });

  it('shows the itemId as a label on the tile', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ deltaText: 'x' }));
    render(
      <JsonNodeTile
        outputPath="prompts/s1.json"
        headlineField="deltaText"
        itemId="scene_1_shot_1"
        status="completed"
      />,
    );
    expect(screen.getByText('scene_1_shot_1')).toBeInTheDocument();
  });

  it('renders a pending-style tile (no body) when no outputPath', () => {
    render(<JsonNodeTile itemId="s1" status="pending" />);
    expect(screen.getByText('s1')).toBeInTheDocument();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('shows a failure indicator when status is failed', () => {
    render(<JsonNodeTile itemId="s5" status="failed" />);
    expect(screen.getByTestId('json-tile-status')).toHaveAttribute('data-status', 'failed');
  });

  it('falls back to a generic preview when headlineField is missing', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ name: 'Ruby', role: 'protagonist' }));
    render(
      <JsonNodeTile
        outputPath="prompts/ruby.json"
        itemId="ruby"
        status="completed"
      />,
    );
    // Generic preview shows at least one key/value pair.
    await waitFor(() => {
      expect(screen.getByText(/Ruby/)).toBeInTheDocument();
    });
  });
});
