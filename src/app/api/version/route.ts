import { readBuildInfo } from '@/lib/build-info'

/**
 * What this deployment was built from, answered over HTTP with no credential.
 *
 * It is separate from `/api/health` deliberately. That route's contract is
 * process liveness and nothing else, because Playwright's webServer waits on
 * it. This one answers a different question, asked by a different caller:
 * `.github/scripts/deployed-commit.mjs` asks the live origin whether it is
 * serving the commit that was just merged, and a scheduled run asks it again
 * every day. See src/lib/build-info.ts for why that question needs asking.
 *
 * It reports and never judges. A deployment that cannot say which commit it is
 * still answers 200 with `commit: null`, and the caller decides what that means
 * (it means "not proven current", and the checker fails closed on it). Two
 * things deciding the same question is how the wrong one ends up winning.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(readBuildInfo(), {
    headers: {
      // A cached answer to "what are you serving right now" is worse than no
      // answer: it is the previous deployment's, given confidently.
      'Cache-Control': 'no-store',
    },
  })
}
