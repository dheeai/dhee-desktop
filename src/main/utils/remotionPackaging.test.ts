import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';

describe('remotion packaging config', () => {
  it('includes key Remotion runtime dependencies in asarUnpack', () => {
    const packageJsonPath = path.join(__dirname, '../../../package.json');
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf-8'),
    ) as {
      build?: { asarUnpack?: string[] };
    };

    const asarUnpack = packageJson.build?.asarUnpack ?? [];
    expect(asarUnpack).toEqual(
      expect.arrayContaining([
        '**/node_modules/@remotion/**',
        '**/node_modules/@react-three/**',
        '**/node_modules/mediabunny/**',
        '**/node_modules/its-fine/**',
        '**/node_modules/suspend-react/**',
        '**/node_modules/execa/**',
        '**/node_modules/extract-zip/**',
        '**/node_modules/source-map/**',
        '**/node_modules/ws/**',
        '**/node_modules/dhee-core/**',
      ]),
    );
  });
});
