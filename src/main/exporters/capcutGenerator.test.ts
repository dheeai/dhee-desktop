import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { generateCapcutProject } from './capcutGenerator';

describe('capcutGenerator watermark export', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds a full-duration watermark text track and material', async () => {
    const tempHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'capcut-watermark-'),
    );
    jest.spyOn(os, 'homedir').mockReturnValue(tempHome);

    try {
      const result = await generateCapcutProject(
        'Storyboard',
        [
          {
            type: 'placeholder',
            path: '',
            duration: 3,
            startTime: 0,
            endTime: 3,
            label: 'Scene 1',
          },
        ],
        '/tmp/project-a',
      );

      const draftInfoPath = path.join(result.outputDir, 'draft_info.json');
      const draftInfo = JSON.parse(await fs.readFile(draftInfoPath, 'utf-8'));

      const textTracks = draftInfo.tracks.filter(
        (track: { type: string }) => track.type === 'text',
      );
      expect(textTracks).toHaveLength(1);

      const watermarkSegment = textTracks[0].segments[0];
      expect(watermarkSegment.render_index).toBe(13000);
      expect(watermarkSegment.target_timerange).toEqual({
        start: 0,
        duration: 3_000_000,
      });
      expect(watermarkSegment.clip.transform.x).toBeCloseTo(0.8);
      expect(watermarkSegment.clip.transform.y).toBeCloseTo(0.9);

      const watermarkMaterial = draftInfo.materials.texts.find(
        (material: { content: string }) =>
          JSON.parse(material.content).text === 'dhee',
      );
      expect(watermarkMaterial).toBeDefined();
      expect(watermarkMaterial.alignment).toBe(2);
      expect(watermarkMaterial.global_alpha).toBeCloseTo(0.46);
      expect(watermarkMaterial.line_max_width).toBeCloseTo(0.24);
    } finally {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });
});
