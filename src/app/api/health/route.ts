/**
 * Liveness probe. Playwright's webServer waits on this rather than on `/` so
 * that a page which fails to render produces a real assertion failure with a
 * screenshot, instead of an opaque "timed out waiting for webServer".
 *
 * It reports process liveness only. It must never check a downstream service,
 * or a broken dependency would stop the whole suite from running.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ ok: true })
}
