import { describe, expect, it } from '@jest/globals';
import {
  buildProjectAbsolutePath,
  getFinalVideoStateWarning,
} from './finalVideoValidation';

describe('finalVideoValidation', () => {
  it('warns when the registered final video file is missing locally', () => {
    const warning = getFinalVideoStateWarning(
      {
        version: '2.0',
        id: 'project-1',
        title: 'Demo',
        original_input_file: 'input.md',
        created_at: 1,
        updated_at: 1,
        current_phase: 'video_combine',
        phases: {} as never,
        content: {} as never,
        characters: [],
        settings: [],
        scenes: [],
        assets: [],
        final_video: {
          artifact_id: 'final-video-1',
          path: 'assets/final_video/final_video.mp4',
          duration: 5,
          created_at: 1,
        },
      },
      {
        schema_version: '1',
        assets: [
          {
            id: 'final-video-1',
            type: 'final_video',
            path: 'assets/final_video/final_video.mp4',
            version: 1,
            created_at: 1,
          },
        ],
      },
      '/tmp/demo.dhee',
      false,
    );

    expect(warning).toContain('registered final_video file is missing');
  });

  it('builds an absolute project-local path from a manifest relative path', () => {
    expect(
      buildProjectAbsolutePath(
        '/tmp/demo.dhee',
        'assets/final_video/final_video.mp4',
      ),
    ).toBe('/tmp/demo.dhee/assets/final_video/final_video.mp4');
  });
});
