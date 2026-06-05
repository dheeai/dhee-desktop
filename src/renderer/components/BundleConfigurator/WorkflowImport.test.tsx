import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkflowImport from './WorkflowImport';

function installElectron(opts: {
  validate: { ok: true } | { ok: false; reason: 'ui_format' | 'invalid' };
  map?: Array<{ input: string; nodeId: string; field: string }>;
}) {
  const validateWorkflow = jest.fn(async () => opts.validate);
  const suggestMap = jest.fn(async () => opts.map ?? []);
  (window as unknown as { electron: unknown }).electron = {
    bundleConfig: { validateWorkflow, suggestMap },
  };
  return { validateWorkflow, suggestMap };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WorkflowImport', () => {
  it('rejects a UI-format workflow with the Dev-mode fix', async () => {
    installElectron({ validate: { ok: false, reason: 'ui_format' } });
    render(<WorkflowImport />);
    fireEvent.change(screen.getByPlaceholderText(/Paste your ComfyUI workflow/i), { target: { value: '{"nodes":[]}' } });
    fireEvent.click(screen.getByText('Validate & map'));
    expect(await screen.findByText(/UI-format workflow/i)).toBeTruthy();
    expect(screen.getByText(/Save \(API Format\)/i)).toBeTruthy();
  });

  it('accepts an API-format workflow and shows the suggested input mappings', async () => {
    const { suggestMap } = installElectron({
      validate: { ok: true },
      map: [
        { input: 'prompt', nodeId: '6', field: 'text' },
        { input: 'seed', nodeId: '3', field: 'seed' },
      ],
    });
    render(<WorkflowImport />);
    fireEvent.change(screen.getByPlaceholderText(/Paste your ComfyUI workflow/i), {
      target: { value: '{"3":{"class_type":"KSampler","inputs":{"seed":0}}}' },
    });
    fireEvent.click(screen.getByText('Validate & map'));

    expect(await screen.findByText(/API-format workflow/i)).toBeTruthy();
    expect(screen.getByText('prompt')).toBeTruthy();
    expect(screen.getByText('seed')).toBeTruthy();
    expect(screen.getByText(/node 6 · text/)).toBeTruthy();
    expect(suggestMap).toHaveBeenCalled();
  });
});
