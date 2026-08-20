import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
       * `server-only` throws the moment it is imported, which is the whole
       * point of it: a module that pulls in the service role key must fail a
       * build rather than reach a browser. React resolves it to an empty module
       * under the `react-server` condition, which is how a server component
       * imports it without exploding, and this alias is that same swap for a
       * suite that has no bundler to apply conditions for it. The marker itself
       * is asserted, against the real module graph, in
       * tests/unit/supabase/service.test.ts.
       */
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Playwright owns tests/e2e. Without this exclude, vitest picks up the spec
    // files and fails on the Playwright test runner import.
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
  },
})
