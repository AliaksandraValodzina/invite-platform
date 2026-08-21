import { NextResponse, type NextRequest } from 'next/server'

import { buyerGet, currentBuyer } from '@/lib/supabase/buyer'
import { UPLOAD_MAX_BYTES, isUploadKind } from '@/lib/uploads'
import { ingestUpload } from '@/lib/uploads/ingest'

/**
 * POST /api/uploads
 *
 * The one endpoint for all three uses. `kind` says which; everything else about
 * the request is identical, which is the whole point of building this once.
 *
 * **Bytes come through the function, and that is a considered choice.** The
 * plan's section 5.1 proposes a presigned PUT so a 10 MB photo never touches a
 * Vercel function, and then, two bullets later, generates derivatives with
 * sharp in a finalise route. Those two cannot both be free: to re-encode an
 * object the function has to hold its bytes, so a presigned upload moves the
 * transfer rather than removing it, and it adds a second round trip, an object
 * that exists before any row does, and a finalise call that can be abandoned.
 * At a 10 MB ceiling and Vercel's 100 MB request body limit, one POST that
 * validates, re-encodes and stores in a single transaction of work is smaller,
 * has fewer states, and cannot leave a bucket full of unfinalised objects.
 * The presigned shape becomes worth its complexity when originals get large
 * enough that holding one in a function is the constraint, which at 10 MB it is
 * not.
 *
 * **Ownership is checked as the buyer, not by us.** The route reads the event
 * with the buyer's own token, so the answer comes from row level security
 * rather than from a `where` clause somebody could forget. Only then does the
 * service role write. That is the same split `src/lib/supabase/buyer.ts`
 * describes: a bug in this file can show a buyer nothing, never somebody
 * else's event.
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

/**
 * Vercel accepts request bodies well above this; the limit that matters is the
 * product's own, and it is checked twice more after this. Reading the declared
 * length first means an oversized upload is refused before its bytes are
 * buffered, which is the difference between a fast refusal and a function that
 * holds 200 MB to say no.
 */
const DECLARED_LENGTH_CEILING = UPLOAD_MAX_BYTES * 2

export async function POST(request: NextRequest): Promise<NextResponse> {
  const buyer = await currentBuyer()
  if (buyer === null) {
    return NextResponse.json(
      { ok: false, message: 'Sign in to upload.' },
      { status: 401, headers: NO_STORE }
    )
  }

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > DECLARED_LENGTH_CEILING) {
    return NextResponse.json(
      { ok: false, message: `Files are limited to ${UPLOAD_MAX_BYTES / 1_000_000} MB each.` },
      { status: 413, headers: NO_STORE }
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Send this as a form with a file field.' },
      { status: 415, headers: NO_STORE }
    )
  }

  const kind = String(form.get('kind') ?? '')
  const eventId = String(form.get('eventId') ?? '')
  const file = form.get('file')

  if (!isUploadKind(kind)) {
    return NextResponse.json(
      { ok: false, message: 'kind must be image, audio or envelope.' },
      { status: 400, headers: NO_STORE }
    )
  }

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, message: 'No file was attached.' },
      { status: 400, headers: NO_STORE }
    )
  }

  /*
   * The event is read with the buyer's own token. An event that is not theirs
   * and an event that does not exist give the same empty result and the same
   * answer, which is the correct amount of information to hand back: whether a
   * given id exists is not something this endpoint should teach anybody.
   */
  const owned = await buyerGet(
    buyer,
    `events?id=eq.${encodeURIComponent(eventId)}&select=id&limit=1`
  )
  if (!owned.ok || !Array.isArray(owned.json) || owned.json.length === 0) {
    return NextResponse.json(
      { ok: false, message: 'That invitation could not be found.' },
      { status: 404, headers: NO_STORE }
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  let outcome
  try {
    outcome = await ingestUpload({ eventId, kind, bytes })
  } catch (error) {
    /*
     * The store refusing its own configuration lands here, and it is the one
     * failure worth reporting verbatim: it is always a deployment mistake and
     * the message names the variable to fix.
     */
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Uploads are unavailable.' },
      { status: 503, headers: NO_STORE }
    )
  }

  if (outcome.kind === 'refused') {
    return NextResponse.json(
      { ok: false, message: capitalise(outcome.reason) },
      { status: outcome.status, headers: NO_STORE }
    )
  }

  if (outcome.kind === 'unavailable') {
    return NextResponse.json(
      { ok: false, message: 'That could not be saved. Try again.' },
      { status: 503, headers: NO_STORE }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      id: outcome.id,
      kind: outcome.uploadKind,
      deduplicated: outcome.deduplicated,
      /*
       * Both numbers, always. The whole justification for accepting a 10 MB
       * photo is that what gets stored and served is a fraction of it, and a
       * claim like that should be visible at the point it is made rather than
       * only in a test.
       */
      originalBytes: outcome.originalBytes,
      storedBytes: outcome.storedBytes,
      variants: outcome.variants,
    },
    { status: 201, headers: NO_STORE }
  )
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
