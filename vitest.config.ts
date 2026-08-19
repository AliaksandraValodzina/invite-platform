import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Playwright owns tests/e2e. Without this exclude, vitest picks up the spec
    // files and fails on the Playwright test runner import.
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
  },
})
