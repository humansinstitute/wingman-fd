import { defineConfig } from 'playwright/test';

const port = process.env.PLAYWRIGHT_PORT || '4173';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const backendUrl = process.env.PLAYWRIGHT_SUPERBASED_URL || 'https://sb4.otherstuff.studio';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: `sh -c 'VITE_DEFAULT_SUPERBASED_URL=${backendUrl} bunx vite --host 127.0.0.1 --port ${port} --strictPort'`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
