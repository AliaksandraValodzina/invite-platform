import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { currentBuyer, loadEventReplies, type Reply, type ReplyColumn } from '@/lib/supabase/buyer'

/**
 * What the guests said.
 *
 * One row per reply, one column per question the event has ever asked. The
 * columns come from the questions and the cells come from the answers, and a
 * question that has been retired still gets a column: a buyer who removed a
 * question yesterday still has answers to it from last month, and dropping the
 * column would look exactly like losing them.
 *
 * A redacted answer shows as "erased", not as blank. Blank would say the guest
 * did not answer; erased says we no longer hold it, which is the promise in the
 * privacy statement being kept in view rather than only in a migration.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Replies',
  robots: { index: false, follow: false },
}

type PageProps = { params: Promise<{ id: string }> }

export default async function RepliesPage({ params }: PageProps) {
  const { id } = await params

  const buyer = await currentBuyer()
  if (buyer === null) redirect('/login')

  const data = await loadEventReplies(buyer, id)

  /*
   * Not found rather than forbidden, and the difference matters. Row level
   * security answers "somebody else's event" with no rows, which is
   * indistinguishable from "no such event" and should be: telling a stranger
   * that an id exists but is not theirs is telling them something.
   */
  if (data === null) notFound()

  const { event, columns, replies } = data

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
          <p className="text-sm text-slate-600">
            <Link href="/dashboard" className="underline">
              All invitations
            </Link>
          </p>
        </div>

        {replies.length > 0 && (
          <a
            data-testid="export-csv"
            href={`/dashboard/${event.id}/replies/export`}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm underline"
          >
            Download as a spreadsheet
          </a>
        )}
      </div>

      <p data-testid="reply-summary" className="text-sm">
        <strong>{replies.length}</strong> {replies.length === 1 ? 'reply' : 'replies'},{' '}
        <strong>{coming(replies)}</strong> coming
      </p>

      {replies.length === 0 ? (
        <p data-testid="replies-empty" className="rounded-md bg-slate-100 p-4">
          Nobody has replied yet. Replies appear here as they arrive.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid="replies-table" className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th scope="col" className="p-2">
                  Coming
                </th>
                <th scope="col" className="p-2">
                  Guests
                </th>
                {columns.map((column) => (
                  <th key={column.questionId} scope="col" className="p-2">
                    {column.prompt}
                    {column.retired && (
                      <span className="block text-xs font-normal text-slate-500">
                        no longer asked
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {replies.map((reply) => (
                <tr key={reply.id} className="border-b border-slate-200 align-top">
                  <td className="p-2">{reply.attendance === 'attending' ? 'Yes' : 'No'}</td>
                  <td className="p-2">{reply.partySize}</td>
                  {columns.map((column) => (
                    <td key={column.questionId} className="p-2">
                      {cell(reply, column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-slate-600">
        These are other people&rsquo;s details, given to you rather than to us. What we keep, for
        how long, and what you are responsible for is in the{' '}
        <Link href="/privacy" className="underline">
          privacy statement
        </Link>
        .
      </p>
    </main>
  )
}

function coming(replies: readonly Reply[]): number {
  return replies.reduce((total, reply) => total + reply.partySize, 0)
}

/**
 * One cell.
 *
 * Three outcomes, and they are three different facts: the answer, "erased"
 * where the retention sweep has been, and an em space where the guest did not
 * answer. Collapsing the last two into one blank cell would make a kept promise
 * look like an unanswered question.
 */
function cell(reply: Reply, column: ReplyColumn) {
  const answer = reply.answers.find((candidate) => candidate.questionId === column.questionId)

  if (answer === undefined) return <span className="text-slate-400">&mdash;</span>
  if (answer.redacted || answer.value === null) {
    return <span className="text-slate-500 italic">erased</span>
  }
  return answer.value
}
