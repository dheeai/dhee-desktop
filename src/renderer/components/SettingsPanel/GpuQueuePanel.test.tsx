import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GpuQueuePanel from './GpuQueuePanel';

it('checks explicitly, labels unchecked workflows honestly, and clears results when endpoint changes', async () => {
  const check = jest.fn(async () => ({
    ok: true,
    workflows: [
      {
        name: 'h3',
        description: 'Video',
        available: true,
        status: 'unchecked',
        inputs: {},
      },
    ],
  }));
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { gpuQueueCatalog: check },
  });
  render(<GpuQueuePanel />);
  expect(check).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('GPU queue MCP endpoint'), {
    target: { value: 'http://localhost:9000/mcp' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  await screen.findByText('Available · not yet verified');
  expect(screen.getByText(/Connected/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('GPU queue MCP endpoint'), {
    target: { value: 'http://localhost:9001/mcp' },
  });
  expect(screen.queryByText('h3')).not.toBeInTheDocument();
});
it('shows connection errors and permits retry', async () => {
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: {
      gpuQueueCatalog: jest.fn(async () => ({
        ok: false,
        error: 'Access denied',
      })),
    },
  });
  render(<GpuQueuePanel />);
  fireEvent.change(screen.getByLabelText('GPU queue MCP endpoint'), {
    target: { value: 'http://localhost/mcp' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Access denied')).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Check connection' }),
    ).toBeEnabled(),
  );
});

it('loads late saved settings without overwriting a user edit', () => {
  const { rerender } = render(<GpuQueuePanel />);
  rerender(<GpuQueuePanel savedEndpoint="http://gpu/mcp" />);
  expect(screen.getByLabelText('GPU queue MCP endpoint')).toHaveValue(
    'http://gpu/mcp',
  );
  fireEvent.change(screen.getByLabelText('GPU queue MCP endpoint'), {
    target: { value: 'http://edited/mcp' },
  });
  rerender(<GpuQueuePanel savedEndpoint="http://elsewhere/mcp" />);
  expect(screen.getByLabelText('GPU queue MCP endpoint')).toHaveValue(
    'http://edited/mcp',
  );
});
it('persists the explicitly checked endpoint', async () => {
  const update = jest.fn(async () => ({}));
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { settings: { update } },
  });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: {
      gpuQueueCatalog: jest.fn(async () => ({ ok: true, workflows: [] })),
    },
  });
  render(<GpuQueuePanel savedEndpoint="http://gpu/mcp" />);
  expect(
    screen.getByRole('button', { name: 'Save connection' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save connection' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await screen.findByText('Connection saved.');
  expect(update).toHaveBeenCalledWith({ gpuQueueUrl: 'http://gpu/mcp' });
});
