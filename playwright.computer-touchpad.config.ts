import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: 'computer-touchpad.spec.ts',
  // Added to the base Chromium project, which the spec gives touch itself.
  projects: [{ name: 'webkit', use: { ...devices['iPhone 13'] } }],
});
