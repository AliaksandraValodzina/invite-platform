import type { Metadata } from 'next'
import Link from 'next/link'

import {
  GRACE_DAYS,
  PURGE_DAYS,
  readPrivacyContact,
  REDACTION_DAYS,
  TAKEDOWN_RESPONSE_WORKING_DAYS,
  UPLOAD_ORIGINAL_RETENTION_DAYS,
} from '@/lib/legal/retention'
import { UPLOAD_KIND_SPECS, UPLOAD_MAX_BYTES } from '@/lib/uploads'

/**
 * The terms between the platform and a buyer.
 *
 * The part that has to be here rather than in a longer document later is the
 * processor terms. For a $39 product there will never be a separately
 * negotiated data processing agreement, so the terms themselves have to carry
 * one: the buyer is the controller of their guests' data, this service is the
 * processor, and what that means in practice is written out rather than named.
 *
 * The other part is the buyer's own obligations, which are the mitigations the
 * plan asks for in the same breath as making the RSVP extensible: do not ask
 * for what you do not need, and you own the copies you export.
 *
 * Same caveat as the privacy statement, and it is on the page: written
 * carefully, not reviewed by anybody qualified.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Terms',
}

export default function TermsPage() {
  const contact = readPrivacyContact()

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 py-12 text-slate-900">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Terms</h1>
        <p className="text-slate-600">
          Between this service and the person who bought an invitation. Guests should read the{' '}
          <Link href="/privacy" className="underline">
            privacy statement
          </Link>{' '}
          instead.
        </p>
      </header>

      <Section title="What you bought">
        <p>
          A hosted invitation page at a link you can share, and a form that collects replies, for
          the hosting term stated on your order. When that term ends the page keeps working for{' '}
          {GRACE_DAYS} more days so that a link already in a group chat does not break, and no new
          replies are accepted during those days.
        </p>
      </Section>

      <Section title="Your guests&rsquo; data is yours to answer for">
        <p>
          <strong>You are the controller of your guests&rsquo; personal information</strong> and
          this service is the processor. In plain terms: they gave it to you, we hold it for you,
          and we act on your instructions.
        </p>
        <p>As processor we undertake to:</p>
        <ul className="list-disc pl-5">
          <li>process guest data only to run your invitation and to support you</li>
          <li>keep it confidential and restrict access to what operating the service requires</li>
          <li>
            erase identifying answers {REDACTION_DAYS} days after your page stops serving, and
            delete the event entirely {PURGE_DAYS} days after that
          </li>
          <li>
            help you answer a guest&rsquo;s request about their data, and route to you any that
            reaches us first
          </li>
          <li>tell you without undue delay if guest data held here is exposed</li>
          <li>delete everything on request when you close your account</li>
        </ul>
        <p>
          The full schedule, and what survives each step, is in the{' '}
          <Link href="/privacy" className="underline">
            privacy statement
          </Link>
          .
        </p>
      </Section>

      <Section title="What you must not ask your guests">
        <p>
          You choose the questions on your reply form, so you decide what your guests are asked to
          hand over. You agree:
        </p>
        <ul className="list-disc pl-5">
          <li>to ask only for what you actually need to run your event</li>
          <li>
            never to ask for government identifiers, passport or licence numbers, payment or bank
            details, or health information beyond dietary requirements
          </li>
          <li>
            to classify each question honestly when you are asked what kind of information it
            collects, because that classification is what decides what gets erased
          </li>
          <li>to tell your guests who you are, if the invitation does not make that obvious</li>
        </ul>
        <p>
          We may remove a question and erase the answers to it if it breaks this, and we will tell
          you why.
        </p>
      </Section>

      <Section title="Copies you download">
        <p>
          You can export your replies as a spreadsheet at any time. Once you do, that file is
          outside this service: the erasure schedule cannot reach it, and neither can we. Keeping it
          safe, and deleting it when you no longer need it, is yours to do.
        </p>
      </Section>

      <Section title="What you upload">
        <p>
          You warrant that you hold the rights to every image, every piece of text and every audio
          file you put on your invitation, and you indemnify us against a claim that you did not.
          Music is where this bites: a song you bought is a song you are licensed to listen to, not
          one you are licensed to publish on a page you send to a hundred people.
        </p>
        <p>
          Report anything that looks like it breaks this to <strong>{contact}</strong>. We answer
          within {TAKEDOWN_RESPONSE_WORKING_DAYS} working days and{' '}
          <strong>remove the single file</strong> rather than the invitation, so a complaint about
          one song does not take down somebody&rsquo;s wedding page. Accounts that do it repeatedly
          are closed.
        </p>
        <p>
          One thing we cannot do, and would rather say than imply otherwise: files are served from
          addresses that browsers are told to keep for a year, because that is what makes an
          invitation fast on a phone. Removing a file stops it being served from then on. It does
          not reach the copy already on the phone of somebody who opened the page yesterday.
        </p>
      </Section>

      <Section title="How much you can upload">
        <p>Per invitation, so that the page stays fast on a guest&rsquo;s phone:</p>
        <ul className="list-disc pl-5">
          <li>{UPLOAD_KIND_SPECS.image.perEvent} photos</li>
          <li>{UPLOAD_KIND_SPECS.audio.perEvent} music file</li>
          <li>{UPLOAD_KIND_SPECS.envelope.perEvent} envelope image</li>
          <li>up to {UPLOAD_MAX_BYTES / 1_000_000} MB per file, straight off your phone</li>
        </ul>
        <p>
          Photos are re-encoded when they arrive, so what your guests download is a fraction of what
          you sent and looks the same on a screen. We keep the file you uploaded for{' '}
          {UPLOAD_ORIGINAL_RETENTION_DAYS} days after you publish, in case you want to re-crop it,
          and then discard it; the versions on your page are kept for as long as the page serves. We
          accept JPEG, PNG, WebP and AVIF images, and MP3 or M4A audio.
        </p>
      </Section>

      <Section title="What we do not promise">
        <p>
          This is a small service. We do not promise uninterrupted availability, and our liability
          is limited to what you paid. Nothing here limits rights you have under the Australian
          Consumer Law or equivalent legislation where you live.
        </p>
      </Section>

      <Section title="Separate from anything else we run">
        <p>
          This service is operated separately from any other product under the same ownership.
          Nothing is shared between them: not accounts, not data, not hosting, not this document.
        </p>
      </Section>

      <p className="text-sm text-slate-600">
        Written carefully and not reviewed by a qualified practitioner. It should be before this
        service takes real money.
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
