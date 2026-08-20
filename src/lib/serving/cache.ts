/**
 * How long a guest page may be cached, and why that number is a privacy control
 * rather than a speed one.
 *
 * `public.event_state_at` returns `unpublished`, `live`, `grace` or `expired` as
 * a pure function of `now()`. Nothing is written when an event expires: the row
 * is untouched at every boundary (docs/data-model.md). So the cache lifetime of
 * the HTML is exactly how long a guest can be shown the wrong serving state,
 * and the state that matters is `live` served after `hosting_expires_at`, which
 * is an open RSVP form collecting new guest PII against lapsed hosting.
 * `20260819010600_rsvps.sql` says that is not defensible, so 60 seconds is a
 * chosen bound and not a guess. Anything measured in hours would not be.
 *
 * The rest of the header, and what each part buys:
 *
 *   public                    the edge may hold one copy for every guest. A
 *                             link pasted into a 120 person group chat is one
 *                             origin render, not 120.
 *   max-age=0, must-revalidate a browser never reuses the HTML without asking.
 *                             With an ETag the ask is a 304 of a few hundred
 *                             bytes, which is what the second and third visit
 *                             cost.
 *   s-maxage=60               the edge absorbs the burst, and bounds the wrong
 *                             state as above.
 *   stale-while-revalidate=300 the 61st second serves the cached page and
 *                             refreshes behind it, so nobody waits on a cold
 *                             render.
 *
 * No `immutable`, ever, on a document. That is for content addressed assets,
 * whose bytes decide their own URL. This page's URL says nothing about its
 * contents.
 *
 * These live in their own module because three things have to agree on them and
 * two of them are not the page: the route's `revalidate`, the response header
 * set in `src/proxy.ts`, and `tests/e2e/caching.spec.ts`, which reads the header
 * off the wire.
 */

/** Seconds the rendered page, and the reads behind it, may be reused. */
export const GUEST_PAGE_REVALIDATE_SECONDS = 60

/** Seconds a stale page may still be served while a fresh one is built. */
export const GUEST_PAGE_STALE_WHILE_REVALIDATE_SECONDS = 300

export const GUEST_PAGE_CACHE_CONTROL = [
  'public',
  'max-age=0',
  `s-maxage=${GUEST_PAGE_REVALIDATE_SECONDS}`,
  `stale-while-revalidate=${GUEST_PAGE_STALE_WHILE_REVALIDATE_SECONDS}`,
  'must-revalidate',
].join(', ')

/** Cache tag for one event, so a publish can invalidate it by id rather than by path. */
export function eventCacheTag(slug: string): string {
  return `event:${slug}`
}
