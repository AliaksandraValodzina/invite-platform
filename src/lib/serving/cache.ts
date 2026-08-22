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
 *
 * A route only reaches that path at all if it exports `generateStaticParams`.
 * Without one, Next renders every request fresh and streams it, and what comes
 * off the wire is `private, no-store` however confident the `revalidate` export
 * looks. Measured on a production build for both `/e/[slug]` and
 * `/t/[templateId]`.
 *
 * The dashboard's header is the opposite decision, made for the same reason.
 * That page is a list of other people's names, contact details and dietary
 * requirements, assembled for one signed-in buyer. Nothing between the database
 * and their screen may keep a copy of it: not a CDN, which would be serving one
 * buyer's guest list from a shared cache, and not the browser, where a back
 * button on a shared laptop is a real way for it to be read by somebody else.
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

/**
 * The template preview, which is the one page here meant to be shared widely
 * and the one that carries nothing about anybody.
 *
 * It renders a design and its example words. There is no couple, no date
 * somebody chose, no guest and no reply, so none of the reasoning above applies
 * and the only question is how long an edit to a template takes to reach a shop
 * listing. Five minutes.
 *
 * The explicit `stale-while-revalidate` is the reason this is written out
 * rather than left to Next. A dynamic route with `revalidate` set gets a
 * default stale window of nearly a year, which would mean a design corrected on
 * Monday still being shown to shoppers in the spring. Five minutes fresh and an
 * hour stale is a bound somebody chose.
 */
export const TEMPLATE_PREVIEW_REVALIDATE_SECONDS = 300

export const TEMPLATE_PREVIEW_STALE_WHILE_REVALIDATE_SECONDS = 3600

export const TEMPLATE_PREVIEW_CACHE_CONTROL = [
  'public',
  'max-age=0',
  `s-maxage=${TEMPLATE_PREVIEW_REVALIDATE_SECONDS}`,
  `stale-while-revalidate=${TEMPLATE_PREVIEW_STALE_WHILE_REVALIDATE_SECONDS}`,
  'must-revalidate',
].join(', ')

/**
 * No copy of a buyer's replies is kept anywhere.
 *
 * `private` says no shared cache may hold it. `no-store` says no cache may hold
 * it at all, which is the one that covers the browser's own disk. Both are
 * present because they are not the same instruction and the weaker one alone is
 * the common mistake.
 */
export const DASHBOARD_CACHE_CONTROL = 'private, no-store, max-age=0, must-revalidate'

/** Cache tag for one event, so a publish can invalidate it by id rather than by path. */
export function eventCacheTag(slug: string): string {
  return `event:${slug}`
}
