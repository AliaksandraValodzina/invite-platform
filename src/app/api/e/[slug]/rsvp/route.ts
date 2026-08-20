import { NextResponse, type NextRequest } from 'next/server'

import { handleRsvpSubmission } from '@/lib/rsvp/handle'
import { fieldsFromFormData, type SubmittedField } from '@/lib/rsvp/submission'

/**
 * POST /api/e/<slug>/rsvp
 *
 * The reply endpoint the build plan names. It accepts a form encoded body, the
 * same shape the guest page's form produces, and hands it to the one function
 * that stores a reply. The guest page itself calls that function through a
 * server action rather than through this route, because the form is a client
 * component in this app and a second HTTP hop to our own origin would buy
 * nothing; this exists because the contract is worth having at a stable address
 * and because a client that is not this app needs one.
 *
 * Never cached, at any layer, in either direction. A POST is not cacheable
 * anyway, and the header says so out loud because this response can carry a
 * message about somebody's invitation.
 */

/*
 * The route reads headers and writes to the database, so it must never be
 * prerendered or reused. `force-dynamic` is right here for exactly the reason
 * it is wrong on the guest page: there is nothing to serve from an edge.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store',
  /*
   * A reply is submitted from the invitation's own page and from nowhere else.
   * There is no `Access-Control-Allow-Origin` here on purpose: a browser will
   * not let another origin read this response, and adding a permissive header
   * would turn one buyer's endpoint into a form anybody can post from.
   */
  Vary: 'Origin',
} as const

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await context.params

  let fields: SubmittedField[]
  try {
    fields = fieldsFromFormData(await request.formData())
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Send this as a form.' },
      { status: 415, headers: NO_STORE }
    )
  }

  const outcome = await handleRsvpSubmission({ slug, fields, headers: request.headers })

  if (outcome.ok) {
    return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE })
  }

  /*
   * One status for every refusal, and the message carries the difference. The
   * alternative is a status code that says which invitation exists and which
   * has lapsed, to anybody who asks, for any slug they can guess. A guest page
   * already tells its own visitor what state it is in; this endpoint does not
   * need to tell everybody else.
   */
  return NextResponse.json(
    {
      ok: false,
      message: outcome.message,
      ...(outcome.issues === undefined ? {} : { issues: outcome.issues }),
    },
    { status: 422, headers: NO_STORE }
  )
}
