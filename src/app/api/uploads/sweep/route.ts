import { NextResponse, type NextRequest } from 'next/server'

import { servicePost } from '@/lib/supabase/service'
import { objectStore } from '@/lib/uploads/store'
import { SWEEP_BATCH, sweepUploadObjects } from '@/lib/uploads/sweep'

/**
 * POST /api/uploads/sweep
 *
 * Drains the object deletion queue. This is the only thing in the product that
 * removes bytes from the store, and it exists because Postgres cannot make an
 * HTTP request: the daily retention sweep decides what should go and records
 * the decision as rows in `public.upload_objects`, and this turns those rows
 * into deletions.
 *
 * Run it on a schedule alongside the database sweep. Until a deployment exists
 * to schedule it on, `scripts/takedown-upload.mjs` calls it, so a takedown is
 * one command rather than two and a wait.
 *
 * **On the authorisation, which is deliberately soft.** With
 * `UPLOADS_SWEEP_SECRET` set, a bearer token matching it is required and this
 * is a private endpoint. With it unset, the call is allowed and bounded to one
 * small batch. That is stated rather than hidden because it is a real decision:
 * the only thing this endpoint can do is delete objects the DATABASE has
 * already condemned and that no live row still references. It cannot be aimed
 * at a key, it cannot delete anything an event is still using, and calling it
 * repeatedly only makes a deletion that was going to happen happen sooner. The
 * cost of an open call is compute, not data, and the cap is what bounds that.
 * The alternative, refusing without a secret, would mean the retention
 * behaviour this stage exists to prove could not be exercised in CI, and an
 * unproven deletion path is the exact failure the plan warns about.
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

/** What one unauthenticated call may remove. Small on purpose. */
const OPEN_BATCH = 50

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = (process.env.UPLOADS_SWEEP_SECRET ?? '').trim()

  if (secret !== '') {
    const offered = request.headers.get('authorization')
    if (offered !== `Bearer ${secret}`) {
      return NextResponse.json(
        { ok: false, message: 'Not authorised.' },
        { status: 401, headers: NO_STORE }
      )
    }
  }

  const limit = secret === '' ? OPEN_BATCH : SWEEP_BATCH

  let store
  try {
    store = objectStore()
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'No object store.' },
      { status: 503, headers: NO_STORE }
    )
  }

  let report
  try {
    report = await sweepUploadObjects(
      {
        async claim(count) {
          const response = await servicePost('rpc/claim_upload_objects', { p_limit: count })
          if (!response.ok || !Array.isArray(response.json)) return []
          return response.json.filter((key): key is string => typeof key === 'string')
        },
        remove: (key) => store.delete(key),
        async mark(key) {
          const response = await servicePost('rpc/mark_upload_object_deleted', { p_key: key })
          return response.ok
        },
      },
      limit
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'The sweep could not run.' },
      { status: 503, headers: NO_STORE }
    )
  }

  return NextResponse.json({ ok: true, ...report, driver: store.driver }, { headers: NO_STORE })
}
