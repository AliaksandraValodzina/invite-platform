import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Type errors must fail the build, never be swallowed by it. Next 16 removed
  // `next lint`, so ESLint is a separate CI step rather than a build option.
  typescript: { ignoreBuildErrors: false },
}

export default nextConfig
