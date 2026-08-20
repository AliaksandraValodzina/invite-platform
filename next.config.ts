import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Playwright drives 127.0.0.1, and `next dev` only trusts localhost by
  // default, so it answered 403 to the one script tag the browser requests with
  // an Origin header. The page still rendered and nothing hydrated, which made
  // every interactive test fail locally while passing in CI, where the suite
  // runs against a production build. Dev only; `next start` ignores it.
  allowedDevOrigins: ['127.0.0.1'],
  // Type errors must fail the build, never be swallowed by it. Next 16 removed
  // `next lint`, so ESLint is a separate CI step rather than a build option.
  typescript: { ignoreBuildErrors: false },
  // `next dev` otherwise appends a block of its own to AGENTS.md on every run.
  // That file is this project's committed agent memory, it has a hard character
  // limit, and a generated block that reappears after every dev server start is
  // an uncommitted change in everybody's tree forever. Its advice, to read the
  // guides under node_modules/next/dist/docs before writing Next code, is good
  // and is kept in AGENTS.md in one line instead.
  agentRules: false,
}

export default nextConfig
