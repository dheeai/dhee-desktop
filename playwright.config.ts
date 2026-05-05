import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 1212);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/e2e',

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'renderer',
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /.*\.live\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Layer 3 (live Electron + real kshana-ink + real ComfyUI) goes here later.
    // Tagged with `.live.spec.ts` so it's excluded from the default run.
  ],

  webServer: {
    command: 'npm run start:test-renderer',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
