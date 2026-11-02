/** @jest-environment node */
import { it, expect } from '@jest/globals';
import { syncAppPackageJson } from '../../.erb/scripts/conditional-install-app-deps.js';

it('rebases repository-local extensions for release/app installation', () => {
  const result = syncAppPackageJson({
    dependencies: {
      'dhee-runner-production': 'file:packages/dhee-runner-production',
    },
  });
  expect(result.dependencies['dhee-runner-production']).toBe(
    'file:../../packages/dhee-runner-production',
  );
});
