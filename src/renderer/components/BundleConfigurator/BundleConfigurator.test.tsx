import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BundleConfigurator from './BundleConfigurator';
import type { EnrichedBundleFit } from '../../../shared/bundleConfigTypes';

const incompleteFit: EnrichedBundleFit = {
  bundleDir: '/x',
  endpoint: 'http://127.0.0.1:8188',
  status: 'incomplete',
  modelsMissing: 1,
  nodesMissing: 1,
  workflows: [
    {
      workflowKey: 'workflows/relay.json',
      ok: false,
      // a same-class installed candidate for the missing model
      available_by_class: { 'UNETLoader.unet_name': ['installed-ltx.safetensors'] },
      missing_refs: [
        {
          nodeType: 'UNETLoader',
          nodeId: 'U',
          inputField: 'unet_name',
          current_value: 'ltx-transformer.safetensors',
          requirement: {
            classField: 'UNETLoader.unet_name',
            canonicalFilename: 'ltx-transformer.safetensors',
            type: 'unet',
            downloadUrl: 'https://hf.example/ltx',
            sizeGb: 11,
          },
        },
      ],
      missing_node_classes: [
        {
          nodeId: 'D',
          class_type: 'LTXVDirector',
          requirement: { classType: 'LTXVDirector', pack: 'ComfyUI-LTXVideo', installVia: 'manager' },
        },
      ],
    },
  ],
};

const readyFit: EnrichedBundleFit = {
  bundleDir: '/x',
  endpoint: 'http://127.0.0.1:8188',
  status: 'ready',
  modelsMissing: 0,
  nodesMissing: 0,
  workflows: [{ workflowKey: 'workflows/relay.json', ok: true, available_by_class: {}, missing_refs: [], missing_node_classes: [] }],
};

function installElectron(check: jest.Mock) {
  const resolve = jest.fn(async () => ({ ok: true as const }));
  (window as unknown as { electron: unknown }).electron = {
    settings: { get: jest.fn(async () => ({ comfyuiMode: 'custom', comfyuiUrl: 'http://127.0.0.1:8188' })) },
    bundleConfig: { check, resolve, resolution: jest.fn(async () => null) },
  };
  return { check, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BundleConfigurator', () => {
  it('renders the missing model and custom-node gaps with their hints', async () => {
    installElectron(jest.fn(async () => incompleteFit));
    render(<BundleConfigurator bundleId="narrative_prompt_relay" />);

    expect(await screen.findByText('ltx-transformer.safetensors')).toBeTruthy();
    expect(screen.getByText(/~11 GB/)).toBeTruthy();
    expect(screen.getByText('Download ↗')).toBeTruthy();
    expect(screen.getByText('LTXVDirector')).toBeTruthy();
    expect(screen.getByText(/ComfyUI-LTXVideo/)).toBeTruthy();
    expect(screen.getAllByText(/missing/i).length).toBeGreaterThan(0);
  });

  it('remapping a model persists a name_alias and re-checks live', async () => {
    // first check → incomplete (gap shown); after resolve → ready.
    const check = jest
      .fn<() => Promise<EnrichedBundleFit>>()
      .mockResolvedValueOnce(incompleteFit)
      .mockResolvedValue(readyFit);
    const { resolve } = installElectron(check as unknown as jest.Mock);
    render(<BundleConfigurator bundleId="narrative_prompt_relay" />);

    const select = await screen.findByLabelText('remap ltx-transformer.safetensors');
    fireEvent.change(select, { target: { value: 'UNETLoader|installed-ltx.safetensors' } });

    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith('http://127.0.0.1:8188', {
        name_aliases: { 'ltx-transformer.safetensors': 'installed-ltx.safetensors' },
      }),
    );
    // re-check ran and the bundle is now ready
    expect(await screen.findByText(/All models .* present/i)).toBeTruthy();
  });

  it('swapping a custom node persists a class_swap for that workflow + node', async () => {
    const check = jest
      .fn<() => Promise<EnrichedBundleFit>>()
      .mockResolvedValueOnce(incompleteFit)
      .mockResolvedValue(readyFit);
    const { resolve } = installElectron(check as unknown as jest.Mock);
    render(<BundleConfigurator bundleId="narrative_prompt_relay" />);

    const swap = await screen.findByLabelText('swap LTXVDirector');
    fireEvent.change(swap, { target: { value: 'LTXVDirectorGGUF' } });
    fireEvent.click(screen.getByText('Use'));

    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith('http://127.0.0.1:8188', {
        class_swaps: { 'workflows/relay.json': { D: 'LTXVDirectorGGUF' } },
      }),
    );
  });

  it('surfaces an endpoint error with the programmatic-access hint', async () => {
    installElectron(jest.fn(async () => ({ error: 'request to http://127.0.0.1:8188/object_info failed' })) as unknown as jest.Mock);
    render(<BundleConfigurator bundleId="x" />);
    expect(await screen.findByText(/Couldn't reach ComfyUI/i)).toBeTruthy();
    expect(screen.getByText(/--listen 0\.0\.0\.0/)).toBeTruthy();
  });
});
