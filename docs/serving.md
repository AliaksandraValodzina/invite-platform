# Serving a guest page

`/e/<slug>` is the first page a guest can open and the first row any code in
this repo reads. Code is in `src/app/e/[slug]/`, the read path is
`src/lib/supabase/`, and the cache decision is `src/lib/serving/cache.ts`.

## One read, four states

`public.event_state_at` decides what a guest request gets. It is a pure function
of the row plus the clock, and nothing is written when an event crosses a
boundary: the row is untouched at expiry, at grace and at everything after
(`docs/data-model.md`).

| State         | Row                                         | What is served                    |
| ------------- | ------------------------------------------- | --------------------------------- |
| `unpublished` | `status <> 'published'`                     | designed notice, no event content |
| `live`        | `now < hosting_expires_at`                  | the invitation, replies open      |
| `grace`       | `hosting_expires_at <= now < grace_ends_at` | the invitation, replies closed    |
| `expired`     | `now >= grace_ends_at`                      | designed notice, no event content |

A slug with no row is a fifth answer: the designed 404 in
`src/app/e/[slug]/not-found.tsx`, served at a real 404 status.

The two states that serve an invitation serve it under a closed envelope, and
the two that serve a notice do not: an envelope over an expiry notice would be a
cover over nothing. The envelope changes nothing else on this page. It is markup
inside the same render, it fetches nothing, it runs no script, and it does not
touch the cache lifetime below, which is a privacy control rather than a speed
one. See `docs/envelope.md`.

There is a sixth, which is not a serving state: `unavailable`. It covers a
database that could not be read, a stored document that no longer validates, and
a published event with no published content revision. All three are ours rather
than the guest's, and all three get a designed apology instead of a stack trace.

### Status codes, and where Next stops

`notFound()` is the only status a page render can choose in the App Router, so
the missing slug case gets a real 404 and the other notices are served at 200
with `robots: noindex`. That is defensible rather than merely convenient: an
unpublished or expired URL is a valid address that a buyer or a guest was
legitimately given, and a 404 would tell them the link was wrong when it is not.
If a status ever has to carry more than that, it needs a route handler or a
rewrite, not a component.

### Guest pages are noindex

An invitation is shared into a chat, not published to the web. It carries a
couple's names, their date and their venue, and a buyer who pasted a link to
twelve people did not ask for a search result. The share card is noindex for the
same reason, and neither setting stops a chat app fetching the page to build its
preview. **This is a default, not a law.** If the captain wants invitations
findable, it is one line in `generateMetadata`.

The page never compares timestamps itself. `20260820010000_event_serving_state.sql`
adds `public.serving_state(events)`, a computed column PostgREST exposes as
`events.serving_state`, so one request answers "what is this event" and "what
should this guest be served" together. Two requests would mean two clocks and
two cache lifetimes, and the page could then outlive the state it was rendered
from.

**The notices are drawn in the app's own type, not the event's theme.** A 404
has no event and so no theme, and an expired page must not carry the couple's
names, date or palette: expiry exists because the hosting they paid for has
lapsed, and dressing that page in their invitation would show the thing it is
refusing to show. Both are asserted in `tests/e2e/guest-page.spec.ts` by
searching the served markup for a fixture name unusual enough that finding it can
only mean it leaked.

## Replies

The RSVP block takes `submit` as a required prop so a form with nowhere to send
a reply cannot be rendered by accident. `src/app/e/[slug]/actions.ts` is that
prop, and it forwards to the one function that stores a reply. The whole reply
path, including why the questions are rows rather than template config, is
`docs/replies.md`.

Two things about it that belong here, because they are about serving:

The form is drawn from the event's live questions, which come back on the **same
PostgREST request** as the event itself. Same argument as `serving_state`: a
second read would be a second clock and a second cache lifetime, and the form a
guest fills in has to be the form the write path is about to validate against.

The write path reads the event again, uncached, and `public.submit_rsvp` reads
the serving state a third time inside the transaction that does the write. That
is deliberate. The page a guest is looking at may be a minute out of date about
whether replies are open; the decision to store what they typed never is.

## Caching, and why it is a privacy control

```
Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300, must-revalidate
```

`s-maxage=60` is **the hard bound on how long a guest can be shown the wrong
serving state.** The state a stale page gets wrong is `live` after
`hosting_expires_at`, which is an open RSVP form collecting new guest PII
against lapsed hosting, and `20260819010600_rsvps.sql` says that is not
defensible. Anything measured in hours would not be a chosen number.

`max-age=0, must-revalidate` means a browser never reuses the HTML without
asking, and with an `ETag` the ask is a 304 rather than a page. There is no
`immutable` anywhere on a document: that directive belongs on content addressed
assets, whose bytes decide their own URL.

Three files have to agree on those numbers, and only two of them can share a
constant:

- `src/lib/serving/cache.ts` holds them and explains them.
- `src/proxy.ts` sets the header from that module.
- `src/app/e/[slug]/page.tsx` exports `revalidate` as a **literal**, because
  Next reads route segment config by static analysis and fails the build on an
  imported value. `tests/unit/serving/page-revalidate.test.ts` reads the source
  and holds the literal to the constant.

### Two measured facts behind that shape

**The route exports `generateStaticParams` returning nothing.** Without it Next
renders every request fresh and streams the response, and a streamed response
carries no `ETag`, so every browser revalidation costs a whole page instead of a 304. With it, the route is on the incremental static regeneration path: the
response is buffered, carries an `ETag`, and answers `If-None-Match` with a 304.
Both behaviours were checked on the wire against `next start`.

**The header is set in `src/proxy.ts` rather than left to Next.** Next's own
header for this route is:

```
Cache-Control: s-maxage=60, stale-while-revalidate=31535940
```

No `max-age`, so a browser applies its own heuristic; no `public`; no
`must-revalidate`; and a stale-while-revalidate window of a year. `proxy.ts`
runs on the way out and is the last word. `next.config.ts` headers are not an
option here: Next documents them as overwritten for pages in production.

Do not copy `export const dynamic = 'force-dynamic'` from the preview route. It
is correct there, for a route that exists to be looked at. On the guest page it
gives up the edge cache entirely and puts every guest's first byte behind a
function invocation.

### Verifying it

`tests/e2e/caching.spec.ts` reads the headers off a real response. It **refuses
to run against the dev server**, because Next's dev server sets different
headers from a production build and there is no CDN in the loop locally, so a
dev assertion proves the one thing that was never in doubt. CI runs it against
`next start`. Set `DEPLOYED_BASE_URL` and `DEPLOYED_EVENT_SLUG` to point it at a
deployment.

The assertion that matters is the last one: a header being present is a claim,
and `transferSize === 0` on reload is the browser confirming it did not go to
the network. Today that is asserted over `/_next/static/`, which is content
addressed by build hash. Buyer uploads join the same assertion when they arrive
rather than getting one of their own.

**Not yet verified:** the CDN half. There is no deployment, so nothing here has
been seen through an edge cache. The by-hand `curl` against the real host stays
on the go-live checklist below.

### The dashboard is the opposite decision

`/dashboard/*` carries `private, no-store, max-age=0, must-revalidate`, set in
the same place for the same reason. It is a list of other people's names,
contact details and dietary requirements assembled for one signed-in buyer:
`public` there would be one buyer's guest list in a CDN, and a browser cache is
how the next person to press the back button on a shared laptop reads it.

`src/proxy.ts` also refreshes the buyer's access token when it has expired,
because a server component cannot set a cookie and Next only allows that in a
route handler or a server action. It is the one place that runs before a page and
can still change the response, which is what both of its jobs need.

### Invalidation

`s-maxage` bounds staleness at 60 seconds, and there is no publish path yet to
invalidate anything sooner. The read is tagged `event:<slug>`
(`eventCacheTag`), so when a publish path lands it can call `revalidateTag` for
one event. Note that on a CDN, `revalidateTag` clears Next's cache and not the
edge copy, so a publish will also need a CDN purge for the same key.

## Running it locally

Nothing here needs a hosted account.

```bash
supabase start                      # applies every migration to a fresh database
cp .env.example .env.local          # then paste in what `supabase status` prints
node scripts/seed-event.ts --title "Emma & Jake" --starts 2027-03-14T16:00:00
npm run dev                         # open /e/<the slug it printed>
```

`scripts/seed-event.ts --state` picks which of the four states the row is in, by
choosing the pair of timestamps either side of now. The browser suite seeds
through the same function, so there is one implementation of "make an event"
rather than two.

## What is still owed to a hosted account

Every value below is read from the environment by the module that needs it, and
none of them appears in this repo. `src/lib/supabase/service.ts` throws naming
all of them at once when they are absent, so a new environment costs one failure
rather than three.

| Variable                    | Read by                       | Absent behaviour                       |
| --------------------------- | ----------------------------- | -------------------------------------- |
| `SUPABASE_URL`              | `src/lib/supabase/service.ts` | throws on the first read, not at build |
| `SUPABASE_SERVICE_ROLE_KEY` | same                          | same                                   |
| `NEXT_PUBLIC_SITE_URL`      | `src/lib/env.ts`              | falls back to `localhost:3000`         |

The go-live checklist, in order, is in the pull request that introduced this
file. The one thing that blocks any of it being public is unchanged:
`public/samples/unlicensed-placeholder/` must be gone or replaced first.
