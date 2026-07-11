// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8080;

// Optional override to run against a pre-installed Chromium (e.g. sandboxed
// CI images that pin a specific browser build). Unset on normal machines,
// where `npx playwright install chromium` provides the matching browser.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

/**
 * Runs the static app under a real Chromium and asserts it loads and plays
 * without JS errors. The webServer is our zero-dep static server so the test
 * exercises the same files GitHub Pages serves.
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: {
    command: `node scripts/serve.js ${PORT}`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
});
