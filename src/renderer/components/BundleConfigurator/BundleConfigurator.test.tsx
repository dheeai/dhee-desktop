import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
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
      available_by_class: {},
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

function installElectron(fit: EnrichedBundleFit | { error: string }) {
  const check = jest.fn(async () => fit);
  (window as unknown as { electron: unknown }).electron = {
    settings: { get: jest.fn(async () => ({ comfyuiMode: 'custom', comfyuiUrl: 'http://127.0.0.1:8188' })) },
    bundleConfig: { check },
  };
  return check;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BundleConfigurator', () => {
  it('renders the missing model and custom-node gaps with their hints', async () => {
    installElectron(incompleteFit);
    render(<BundleConfigurator bundleId="narrative_prompt_relay" />);

    // model gap + its curated size/download hint
    expect(await screen.findByText('ltx-transformer.safetensors')).toBeTruthy();
    expect(screen.getByText(/~11 GB/)).toBeTruthy();
    expect(screen.getByText('Download ↗')).toBeTruthy();

    // custom-node gap + its pack hint
    expect(screen.getByText('LTXVDirector')).toBeTruthy();
    expect(screen.getByText(/ComfyUI-LTXVideo/)).toBeTruthy();

    // rolled-up status (chip + group headings all mention "missing")
    expect(screen.getAllByText(/missing/i).length).toBeGreaterThan(0);
  });

  it('shows a ready state with no gap rows when everything is present', async () => {
    installElectron({
      bundleDir: '/x',
      endpoint: 'http://127.0.0.1:8188',
      status: 'ready',
      modelsMissing: 0,
      nodesMissing: 0,
      workflows: [{ workflowKey: 'workflows/a.json', ok: true, available_by_class: {}, missing_refs: [], missing_node_classes: [] }],
    });
    render(<BundleConfigurator bundleId="ready_bundle" />);
    expect(await screen.findByText(/All models .* present/i)).toBeTruthy();
  });

  it('surfaces an endpoint error with the programmatic-access hint', async () => {
    installElectron({ error: 'request to http://127.0.0.1:8188/object_info failed' });
    render(<BundleConfigurator bundleId="x" />);
    expect(await screen.findByText(/Couldn't reach ComfyUI/i)).toBeTruthy();
    expect(screen.getByText(/--listen 0\.0\.0\.0/)).toBeTruthy();
  });
});
