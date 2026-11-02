import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: 'computer-clipboard.spec.ts',
  projects: [
    ...(config.projects ?? []),
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
