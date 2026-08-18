import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3000)
const BASE_URL = `http://127.0.0.1:${PORT}`
const IS_CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // A test that only passes on a retry is a flake, and on CI a stray .only is a
  // silently narrowed suite. Both fail the build instead.
  forbidOnly: IS_CI,
  retries: 0,
  workers: IS_CI ? 1 : '50%',
  reporter: IS_CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 320px is the width the guest pages are contracted to work at, so it is a
      // first class run rather than something checked by hand later.
      name: 'mobile-320',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 }, isMobile: false },
    },
  ],

  webServer: {
    // CI builds first and runs the suite against the production output. Locally
    // the dev server keeps the loop fast.
    command: IS_CI ? `npm run start -- --port ${PORT}` : `npm run dev -- --port ${PORT}`,
    // Waits on the health route, not on `/`. If the home page throws, we want a
    // failed assertion with a screenshot rather than a webServer start timeout.
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
