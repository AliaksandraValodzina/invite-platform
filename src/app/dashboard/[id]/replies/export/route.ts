import { NextResponse, type NextRequest } from 'next/server'

import { CSV_FIXED_HEADERS, repliesFileName, toCsv, type CsvRow } from '@/lib/dashboard/csv'
import { currentBuyer, loadEventReplies } from '@/lib/supabase/buyer'

/**
 * The replies, as a file.
 *
 * This is the export the plan asks for, and it is also the moment guest data
 * leaves the controls this repo built. Once it is a file on a laptop, the
 * retention sweep cannot reach it, row level security does not apply to it, and
 * a copy in an email attachment is a copy nobody can count. That is not a
 * reason to withhold it, because a caterer needs a list, but it is the reason
 * the response says so and the reason the terms make the buyer the controller
 * of what happens next.
 *
 * The read goes through the buyer's own session, so an id that is not theirs
 * comes back empty from the database rather than being filtered here.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params

  const buyer = await currentBuyer()
  if (buyer === null) {
    // Relative, like every other redirect on the session path: see
    // src/app/auth/callback/route.ts for why an absolute one is wrong here.
    return new NextResponse(null, {
      status: 303,
      headers: { Location: '/login', 'Cache-Control': 'private, no-store' },
    })
  }

  const data = await loadEventReplies(buyer, id)
  if (data === null) {
    return new NextResponse('No such invitation.', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const headers = [...CSV_FIXED_HEADERS, ...data.columns.map((column) => column.prompt)]

  const rows: CsvRow[] = data.replies.map((reply) => [
    reply.createdAt,
    reply.attendance === 'attending' ? 'yes' : 'no',
    String(reply.partySize),
    ...data.columns.map((column) => {
      const answer = reply.answers.find((candidate) => candidate.questionId === column.questionId)
      if (answer === undefined) return ''
      // Same three outcomes as the table on screen: an answer, an erasure, or a
      // question this guest did not answer.
      if (answer.redacted || answer.value === null) return 'erased'
      return answer.value
    }),
  ])

  const body = toCsv(headers, rows)
  const fileName = repliesFileName(data.event.slug, new Date().toISOString())

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
