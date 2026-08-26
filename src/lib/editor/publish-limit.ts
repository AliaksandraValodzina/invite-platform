import { failed, type SaveResult } from './result'

/**
 * One published invitation at a time per account, on the app's side of the line.
 *
 * The captain's decision of 2026-08-24. The RULE is
 * `public.events_publish_limit` in the database
 * (20260826010000_one_published_invitation.sql), and it has to be, because two
 * publish presses in two tabs are two requests and a check in front of a write
 * can be raced. What lives here is the wording, and one string that has to keep
 * agreeing with a migration nobody editing this file is looking at.
 *
 * Its own module, and pure, because a `'use server'` file may export nothing but
 * async functions, and because a constant that has to match a migration deserves
 * somewhere a unit test can reach without a request in its hand.
 * `tests/unit/dashboard/publish-limit.test.ts` reads the migration and fails if
 * the sentence moves.
 *
 * Why the limit matters more than it looks: the free launch opened
 * `/t/<templateId>/use`, so anybody may mint unlimited copies of a free
 * template. This is the only thing between that and somebody running a wedding
 * business on one design, because every published event costs hosting for its
 * full term and a draft costs nothing.
 */

/** The words the trigger raises, matched to tell it from every other refusal. */
export const PUBLISH_LIMIT_MARKER = 'only one may be published at a time'

/**
 * What a buyer is told when their account already has a page in front of guests.
 *
 * It says what to do, because the limit is not a wall: take the other one down
 * and this one goes up. `title` is null on the raced path, where the other
 * invitation was published a moment ago by another tab and naming it would mean
 * a second read on a request that is already answering a refusal.
 */
export function alreadyPublished(title: string | null): SaveResult {
  const which = title === null ? 'Another invitation' : `"${title}"`

  return failed(
    `${which} on this account is already published, and only one can be published at a time. ` +
      'Take that one down and this one can go up. Nothing is lost either way.',
    [{ path: 'publication', message: 'one published invitation at a time' }]
  )
}
