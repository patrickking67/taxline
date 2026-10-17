import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build, served under the same
// base path GitHub Pages uses, so base-path and asset bugs surface here.
const PORT = 4173;
const BASE = '/taxline';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE}/`,
    trace: 'retain-on-failure',
    // Optional: run against an existing Chromium instead of a downloaded one.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /layout\.spec\.ts/ },
  ],
  webServer: {
    command: `node e2e/serve.mjs`,
    env: { BASE_PATH: BASE, PORT: String(PORT) },
    url: `http://localhost:${PORT}${BASE}/`,
    reuseExistingServer: !process.env.CI,
  },
});
