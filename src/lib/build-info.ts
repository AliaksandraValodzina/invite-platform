/**
 * What commit the running deployment was built from.
 *
 * This exists because of a specific failure. On 2026-08-24 a merge to `main`
 * produced no Vercel deployment at all: GitHub handed the push to the Vercel
 * GitHub App (it opened a check suite for it two seconds after the push), and
 * nothing came back. No deployment record, no commit status, no error. The live
 * site went on serving the previous commit for a day and the only thing that
 * eventually noticed was a person reading the page.
 *
 * The lesson is that "did the deploy happen" cannot be answered by asking the
 * thing that was supposed to do it. It has to be answered by asking the live
 * address what it is serving, over HTTP, the way a guest would. That is what
 * `/api/version` is for and this is what it reports.
 *
 * Two sources, in order, because there are two ways a deployment can legitimately
 * come into being:
 *
 *   - `NEXT_PUBLIC_BUILD_COMMIT` is stamped by the publisher in
 *     `.github/workflows/ci.yml`. It is `NEXT_PUBLIC_` for a mechanical reason
 *     rather than a privacy one: Vercel does not carry a build-time variable
 *     into a function's runtime environment unless it is a project setting, and
 *     `NEXT_PUBLIC_` is the prefix Next inlines at build time. A commit hash of
 *     a public repository is not a secret.
 *   - `VERCEL_GIT_COMMIT_SHA` is Vercel's own, set when Vercel's git integration
 *     or a dashboard redeploy built it. It answers for deployments this repo's
 *     CI did not make.
 *
 * `source` says which one answered, so a deployment nobody expected can be told
 * from one CI published.
 */

export type BuildSource = 'ci' | 'vercel-git' | 'unknown'

export type BuildInfo = {
  /** Full 40 character commit sha, or null when the deployment cannot say. */
  commit: string | null
  /** Which of the two variables answered. */
  source: BuildSource
}

const FULL_SHA = /^[0-9a-f]{40}$/

/**
 * A sha or nothing. Anything that is not a full hash is treated as absent
 * rather than reported, because the whole value of this endpoint is that a
 * checker can trust what it says. An unexpanded `${GITHUB_SHA}`, an empty
 * string or an abbreviated hash would each turn a real mismatch into a
 * confusing one.
 */
function fullSha(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim().toLowerCase()
  return FULL_SHA.test(trimmed) ? trimmed : null
}

/**
 * Takes its sources as an argument so tests can exercise present, absent and
 * malformed values without touching the real environment. The default reads
 * `process.env.NEXT_PUBLIC_BUILD_COMMIT` as a literal property access on
 * purpose: that is the only form Next's build-time inlining recognises.
 */
export function readBuildInfo(
  source: { stamped?: string | undefined; vercelGit?: string | undefined } = {
    stamped: process.env.NEXT_PUBLIC_BUILD_COMMIT,
    vercelGit: process.env.VERCEL_GIT_COMMIT_SHA,
  }
): BuildInfo {
  const stamped = fullSha(source.stamped)
  if (stamped !== null) return { commit: stamped, source: 'ci' }

  const fromVercel = fullSha(source.vercelGit)
  if (fromVercel !== null) return { commit: fromVercel, source: 'vercel-git' }

  return { commit: null, source: 'unknown' }
}
