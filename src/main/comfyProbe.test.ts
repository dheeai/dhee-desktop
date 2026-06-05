import { describe, expect, it } from '@jest/globals';
import { summarizeObjectInfo, buildProbeResult } from './comfyProbe.js';

describe('summarizeObjectInfo', () => {
  it('counts distinct model filenames across *_name fields and node classes', () => {
    const info = {
      UNETLoader: { input: { required: { unet_name: [['a.safetensors', 'b.safetensors'], {}] } } },
      VAELoader: { input: { required: { vae_name: [['a.safetensors'], {}] } } }, // dup 'a' across classes
      KSampler: { input: { required: { seed: [['x'], {}] } } }, // not a *_name field → ignored
    };
    expect(summarizeObjectInfo(info)).toEqual({ modelCount: 2, nodeClasses: 3 });
  });

  it('handles an empty payload', () => {
    expect(summarizeObjectInfo({})).toEqual({ modelCount: 0, nodeClasses: 0 });
  });
});

describe('buildProbeResult', () => {
  it('maps version / GPU / VRAM (rounded to GB) + counts', () => {
    const stats = {
      system: { comfyui_version: '0.3.41' },
      devices: [{ name: 'NVIDIA RTX 4090', vram_total: 24 * 1e9 }],
    };
    const info = {
      UNETLoader: { input: { required: { unet_name: [['flux.safetensors'], {}] } } },
      KSampler: { input: { required: {} } },
    };
    expect(buildProbeResult(stats, info)).toEqual({
      ok: true,
      version: '0.3.41',
      gpuName: 'NVIDIA RTX 4090',
      vramGb: 24,
      modelCount: 1,
      nodeClasses: 2,
    });
  });

  it('omits absent optional fields (no GPU / version)', () => {
    const res = buildProbeResult({}, {});
    expect(res).toEqual({ ok: true, modelCount: 0, nodeClasses: 0 });
  });
});
