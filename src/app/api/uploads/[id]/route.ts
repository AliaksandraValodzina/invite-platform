import { NextResponse } from 'next/server'

import { buyerGet, currentBuyer } from '@/lib/supabase/buyer'
import { disableUpload } from '@/lib/supabase/uploads'

/**
 * DELETE /api/uploads/<id>
 *
 * Takes one asset off an invitation, without touching the invitation.
 *
 * That separation is the mechanism the terms page depends on. Buyers will
 * upload copyrighted music, somebody will complain about one song, and the
 * answer cannot be "the wedding page is down". So a takedown is per asset: the
 * event, its other photographs and its replies are all untouched.
 *
 * **Disabling deletes the bytes**, and that is forced by the caching decision
 * rather than chosen. Every asset address carries a one year `immutable` cache
 * lifetime, so there is no flag, no header and no purge that un-serves a URL
 * somebody already holds. Removing the object is the only thing that actually
 * stops it, and even that leaves whoever already downloaded it holding a copy.
 * That is the honest limit of what a takedown can do here, and it is worth
 * knowing before promising a response time to a rights holder.
 *
 * The buyer can call this for their own assets, which is the common case: they
 * changed their mind about a photo. A complaint from outside is handled by the
 * platform with `scripts/takedown-upload.mjs`, which calls the same database
 * function with the service role, so there is one implementation of "take this
 * down" rather than a buyer path and an admin path that drift.
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params

  const buyer = await currentBuyer()
  if (buyer === null) {
    return NextResponse.json(
      { ok: false, message: 'Sign in first.' },
      { status: 401, headers: NO_STORE }
    )
  }

  /*
   * Read as the buyer, so row level security decides whether this asset is
   * theirs. A row that is not theirs and a row that does not exist look the
   * same from here and get the same answer.
   */
  const owned = await buyerGet(buyer, `uploads?id=eq.${encodeURIComponent(id)}&select=id&limit=1`)
  if (!owned.ok || !Array.isArray(owned.json) || owned.json.length === 0) {
    return NextResponse.json(
      { ok: false, message: 'That file could not be found.' },
      { status: 404, headers: NO_STORE }
    )
  }

  const disabled = await disableUpload(id, 'removed by the buyer')

  /*
   * Already disabled answers 200 as well. This is an idempotent instruction:
   * a buyer who presses remove twice, or a retry after a dropped connection,
   * should not see a failure for something that is already true.
   */
  return NextResponse.json({ ok: true, disabled }, { status: 200, headers: NO_STORE })
}
