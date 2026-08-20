import type { Metadata } from 'next'
import Link from 'next/link'

import {
  GRACE_DAYS,
  PURGE_DAYS,
  readDataRegion,
  readPrivacyContact,
  REDACTION_DAYS,
  SWEEP_TIME_UTC,
} from '@/lib/legal/retention'

/**
 * The platform's privacy statement.
 *
 * It ships in the stage that first collects a guest's name, and that is the
 * only sensible order: a document written after the data arrives is a document
 * written to describe whatever happened.
 *
 * Three things about how it is written.
 *
 * **Two kinds of person.** Buyers are customers. Guests are not, they have no
 * account, and their details are here because somebody else asked for them.
 * Most privacy policies get this wrong by writing one section as though
 * everybody is a user, and it is the difference that decides who answers a
 * guest's request.
 *
 * **The numbers come from the code.** `src/lib/legal/retention.ts` holds them
 * and `tests/unit/legal/retention.test.ts` reads the migrations to check that
 * they still match. Retention text that disagrees with the sweep is worse than
 * none.
 *
 * **Nothing here is shared with any other project.** Separate entity, separate
 * contact, separate hosting, per the captain's rule.
 *
 * It is not legal advice and it has not been reviewed by anybody qualified.
 * That is stated on the page rather than only here.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Privacy',
}

export default function PrivacyPage() {
  const contact = readPrivacyContact()
  const region = readDataRegion()

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 py-12 text-slate-900">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="text-slate-600">
          What this service collects, who can see it, and how long it is kept.
        </p>
      </header>

      <Section title="Two kinds of person, and you are probably the second">
        <p>
          <strong>Buyers</strong> bought an invitation and have an account here.
        </p>
        <p>
          <strong>Guests</strong> replied to an invitation somebody sent them. If that is you: you
          have no account with us, you did not sign up, and your details are held because the person
          who invited you asked for them. This page is mostly about you.
        </p>
      </Section>

      <Section title="What is collected from a guest">
        <p>Only what the reply form asks, and only what you typed into it:</p>
        <ul className="list-disc pl-5">
          <li>whether you are coming, and how many people you are bringing</li>
          <li>
            the answers you gave to the questions on the form, which usually include your name
          </li>
          <li>
            anything the hosts chose to ask, which commonly includes an email address and dietary
            requirements
          </li>
        </ul>
        <p>
          <strong>
            No IP address, no browser or device information, no referrer, and no analytics or
            advertising trackers of any kind.
          </strong>{' '}
          The reply endpoint counts requests briefly, in memory, to stop automated abuse, and what
          it holds is a one-way hash that is discarded when the process restarts. Nothing about your
          device is written to the database. That is unusual and it is worth saying plainly.
        </p>
        <p>
          Dietary requirements are health information, and read together they can suggest religious
          belief. They are treated as sensitive throughout: classified as such on the question
          itself, and erased on the schedule below by a job that reads that classification rather
          than the words you wrote.
        </p>
      </Section>

      <Section title="Who can see a reply">
        <ul className="list-disc pl-5">
          <li>
            <strong>The hosts</strong> who sent you the invitation. They can read replies and delete
            them. They cannot edit what you wrote.
          </li>
          <li>
            <strong>Us</strong>, as the operator, for support and where the law requires it. This is
            technically unavoidable, because we run the database, and it is listed here rather than
            left implied.
          </li>
          <li>
            <strong>Nobody else.</strong> Replies are not public, not readable from the invitation
            page, not sold, and not shared with any advertiser. There is no third party analytics on
            the invitation page.
          </li>
        </ul>
        <p>
          The hosts can download their replies as a spreadsheet, because a caterer needs a list.
          Once they do, that copy is theirs and the schedule below no longer reaches it. They are
          responsible for what happens to it.
        </p>
      </Section>

      <Section title="How long it is kept">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-300">
              <th scope="col" className="py-2 pr-4">
                When
              </th>
              <th scope="col" className="py-2">
                What happens
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200 align-top">
              <th scope="row" className="py-2 pr-4 font-normal">
                Hosting ends
              </th>
              <td className="py-2">
                The invitation page keeps working for {GRACE_DAYS} more days. No new replies are
                accepted from this moment.
              </td>
            </tr>
            <tr className="border-b border-slate-200 align-top">
              <th scope="row" className="py-2 pr-4 font-normal">
                {GRACE_DAYS} days later
              </th>
              <td className="py-2">The invitation page stops showing the event.</td>
            </tr>
            <tr className="border-b border-slate-200 align-top">
              <th scope="row" className="py-2 pr-4 font-normal">
                {REDACTION_DAYS} days after that
              </th>
              <td className="py-2">
                <strong>Every answer that is about a person is erased.</strong> Names, contact
                details, dietary notes and messages are set to empty and cannot be restored. What
                survives is the count: whether a reply said yes or no, how many people it was for,
                and any answer the hosts marked as being about nobody, such as a menu choice.
              </td>
            </tr>
            <tr className="border-b border-slate-200 align-top">
              <th scope="row" className="py-2 pr-4 font-normal">
                {PURGE_DAYS} days after the page stops serving
              </th>
              <td className="py-2">The event and everything under it is deleted outright.</td>
            </tr>
            <tr className="align-top">
              <th scope="row" className="py-2 pr-4 font-normal">
                If the hosts close their account
              </th>
              <td className="py-2">Everything under it is deleted immediately.</td>
            </tr>
          </tbody>
        </table>
        <p>
          The erasure job runs every day at {SWEEP_TIME_UTC} UTC and records that it ran, so a day
          it did not run is something we can see rather than something nobody notices. The database
          itself refuses to hold a half-erased reply, so a job that only half worked fails loudly
          instead of leaving convincing-looking rows behind.
        </p>
      </Section>

      <Section title="Asking to be erased sooner">
        <p>
          You can ask at any time and you do not have to give a reason. Write to{' '}
          <strong data-testid="privacy-contact">{contact}</strong> with the invitation link you
          replied to and the name you replied under.
        </p>
        <p>
          We will answer within <strong>30 days</strong> and usually within a few working days.
          Erasure is a delete rather than a flag: the reply stops existing.
        </p>
        <p>
          You can also ask the hosts, who can delete your reply themselves. If you would rather not
          contact them, write to us instead.
        </p>
      </Section>

      <Section title="Where it is stored">
        <p>
          The database is hosted in <strong data-testid="data-region">{region}</strong>. If you and
          the hosts are in different countries, your reply crosses a border to get to them, which is
          true of any hosted service and is stated here because it should be.
        </p>
      </Section>

      <Section title="Australian Privacy Act, GDPR and UK GDPR">
        <p>
          This service is operated from Australia. Dietary requirements are health information under
          the Privacy Act, and read together with a name they can suggest religious belief; both
          count as sensitive information. A small business exemption may currently apply to us on
          turnover, and we are not relying on it: this document is written to the Australian Privacy
          Principles because the alternative is holding sensitive information about people who are
          not our customers on the strength of an exemption that is under active reform.
        </p>
        <p>
          If a guest is in the EU or the UK: the hosts are the controller of their guests&rsquo;
          data and we are the processor acting on the hosts&rsquo; instructions. The processing
          terms between us and the hosts are in the{' '}
          <Link href="/terms" className="underline">
            terms
          </Link>
          . Guests may exercise their rights with either of us and we will route the request.
        </p>
      </Section>

      <Section title="If a buyer asks a question they should not">
        <p>
          Hosts choose the questions on their own reply form. They are told, in the terms, not to
          ask for anything they do not need, and never for government identifiers, payment details
          or health information beyond dietary requirements. A form is limited in how many questions
          it can ask and how long a question can be.
        </p>
        <p>
          If you have been asked something that seems wrong, tell us at <strong>{contact}</strong>.
          We can remove a question and erase the answers to it.
        </p>
      </Section>

      <Section title="Changes, and the honest caveat">
        <p>
          If the retention schedule above changes, it changes here and in the code that runs it at
          the same time, because the page reads its numbers from the same place the job does.
        </p>
        <p className="text-slate-600">
          This document describes what the software actually does, and it has been written
          carefully. It is not legal advice and it has not yet been reviewed by a qualified
          practitioner. It should be before this service takes real money.
        </p>
      </Section>

      <p className="text-sm text-slate-600">
        <Link href="/terms" className="underline">
          Terms
        </Link>
      </p>
    </main>
  )
}

function Section({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  )
}
