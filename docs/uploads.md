# Uploads: one capability, three uses

Buyer photographs, the one music file and the envelope artwork are the same
capability wearing three hats. Each needs somewhere to put bytes, a size limit,
a list of formats we accept, a rule about who answers for the content, and a
schedule for throwing it away. Built three times they would differ three ways,
and the difference nobody would notice is the one in the retention schedule.

So there is one table with a `kind` column, one ingest function, one object
store interface, one paragraph of terms, and one place that decides how many of
each an event may hold.

|                                         | Where                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| The three uses and their limits         | `src/lib/uploads/kinds.ts`                                                        |
| What a file actually is                 | `src/lib/uploads/formats.ts`                                                      |
| Content addressing and the cache header | `src/lib/uploads/address.ts`                                                      |
| Which hostname a browser is given       | `src/lib/uploads/host.ts`                                                         |
| Re-encoding                             | `src/lib/uploads/encode.ts`                                                       |
| The one path in                         | `src/lib/uploads/ingest.ts`                                                       |
| Somewhere to put bytes                  | `src/lib/uploads/store/`                                                          |
| Removing bytes                          | `src/lib/uploads/sweep.ts`                                                        |
| Rows, limits, retention                 | `supabase/migrations/20260821010300_uploads.sql`, `…010400_uploads_retention.sql` |
| The endpoints                           | `src/app/api/uploads/`, `src/app/a/[...key]/route.ts`                             |

## The limits

The captain's numbers, 2026-08-20. They live in `public.upload_kind_cap` and in
`UPLOAD_KIND_SPECS`, and `tests/unit/uploads/limits.test.ts` reads the migration
and fails when the two stop agreeing.

|                                   | Cap   |
| --------------------------------- | ----- |
| Photos per event                  | 30    |
| Music files per event             | 1     |
| Envelope images per event         | 1     |
| Bytes accepted per file           | 10 MB |
| Bytes stored and served per event | 50 MB |

**10 MB is what we accept, not what we store.** A photograph straight off a
phone is 3 to 8 MB, and refusing it is a support ticket. Accepting it and
storing an optimised version is the product working. The number that decides
the bill is the per event variant budget, which bounds what is served.

Every limit is enforced by a trigger on the insert, not by the route. The route
checks too, so a buyer gets a sentence rather than a stack trace, but two
uploads in flight can both pass a count-then-insert in application code. A
trigger cannot be raced and cannot be forgotten by the next route that writes to
the table.

## Re-encoding

Images are decoded and written out again as WebP at the widths the page draws:
480, 960 and 1600 for a photo, 800 and 1600 for envelope artwork. Nothing is
ever enlarged, so a 600 pixel upload produces one derivative rather than three.

Measured, on the 1500 by 2100 photograph committed under `public/samples/`:
**408,775 bytes in, 123,568 bytes at the width a phone draws.** The same file
scaled to a phone's own 4032 by 3024 is 1,118,636 bytes in and 190,898 bytes out
across every width. `tests/unit/uploads/encode.test.ts` prints both.

Orientation is applied before metadata is dropped, so a portrait photo is not
sideways, and dropping the metadata takes the GPS coordinates with it: a phone
photograph carries wherever it was taken, and an invitation is a bad place to
publish somebody's home address.

**There is no original-format fallback**, which is a deliberate departure from
the plan's section 5.1. The fallback was for browsers without WebP; the last of
those is Safari 13, and generating one would spend a third of the per event
storage budget on files nobody requests. If a device ever turns up that needs
one it arrives as another entry in the kind's variant plan, and every existing
address keeps working, because addresses are derived from bytes rather than from
a scheme.

Audio is not transcoded. An ffmpeg pipeline is real work and buys little at this
size, and 10 MB is about eleven minutes at 128 kbps.

## Content addressing, and the cache lifetime it earns

An object's key is the sha256 of its own bytes, truncated to 24 hex characters,
plus a derivative label and an extension: `9f3c1e2b7a04…-w960.webp`. Each stored
object, original and derivative alike, is named by its own bytes.

- A buyer who re-crops gets different bytes, a different hash and a different
  URL. The old URL keeps serving whoever holds it, which is what should happen
  during the seconds when a page has re-rendered but a guest's browser still
  holds the old HTML. **Cache invalidation is not solved here, it is deleted as
  a problem.**
- Changing the encoder changes the addresses, so quality can be tuned without a
  purge and without a stale image anywhere.
- The same file uploaded twice costs one object.

That is what makes `Cache-Control: public, max-age=31536000, immutable` safe.
`immutable` tells a browser not to ask again, and it can only ever be true
because the answer at a content address cannot change.

24 characters rather than the plan's 12: 12 is 48 bits, which reaches an even
chance of a collision at about 16 million objects, and the failure is one
buyer's photograph on another buyer's invitation.

**A shared key is the normal case, not an edge one.** Two events that upload the
same file get one object with two rows pointing at it. Nothing in this
capability ever deletes an object because one row stopped needing it:
`public.claim_upload_objects` checks whether any live upload still references
the key first. Skip that check and a takedown on one wedding blanks the artwork
on another.

## Which hostname

The captain's storage decision came with a consequence that outlives the
provider choice: **the app only ever names a platform-owned hostname, so the
vendor stays swappable by DNS and no buyer's stored asset URL is ever a
Cloudflare address.**

Two things enforce it.

**Nothing stores a URL.** `public.uploads` holds keys. A URL is built at render
time from the key and `NEXT_PUBLIC_ASSET_HOST`. Template content that names an
upload names it as `/a/<key>`, which `imageSourceSchema` already accepts as an
app served path.

**A vendor hostname is refused.** `readAssetHostConfig` rejects an origin
belonging to a storage vendor, so a deployment cannot be configured into the
state the decision forbids by somebody pasting a bucket URL into an environment
variable at 11pm.

With no hostname configured, assets are served by this app at `/a/<key>` with
the same headers. That is a real serving path rather than a stub, which is what
lets the caching requirement be read off the wire locally and in CI.

## The store

`ObjectStore` has four operations and no more: `put`, `get`, `delete`, `has`.
There is deliberately no `list`, no `copy` and no signed URL minting.

Selection is by configuration. With every R2 variable present, R2, over its S3
compatible API, signed by hand rather than through an SDK (the signature is
checked against AWS's own published test vector). Otherwise the local
filesystem, rooted at `.uploads`, which this repo ignores.

**The local fallback is not allowed to be silent in a deployment.** A CDN in
front of a bucket the deployment cannot write to means every upload succeeds and
every guest gets a broken image. So `assertStoreIsUsable` refuses the pairing:
if a deployment names an asset hostname, it must have a real store behind it.

## The route that takes bytes

`POST /api/uploads`, multipart, with `kind`, `eventId` and `file`.

Bytes come through the function, which is a departure from the plan's presigned
PUT, and the reason is that the plan asks for both a presigned upload and
re-encoding with sharp in a finalise route. Those two cannot both be free: to
re-encode an object a function has to hold its bytes, so a presigned upload
moves the transfer rather than removing it, and adds a round trip, an object
that exists before any row does, and a finalise call that can be abandoned. At a
10 MB ceiling one POST that validates, re-encodes and stores is smaller and has
fewer states. The presigned shape becomes worth its complexity when holding an
original in a function is the constraint, which at 10 MB it is not.

Ownership is checked by reading the event **as the buyer**, so the answer comes
from row level security rather than from a `where` clause somebody could forget.
Only then does the service role write.

## Getting an upload onto a page

Storing bytes is half of a use. The other half is a document naming them, and
each kind names them differently: a photo goes in a block's content, the music
file will name one key, and the envelope is the cover the guest opens first.

One function serves every picture in the format, and it is `pictureFromUpload`
in `src/lib/uploads/picture.ts`. It takes the variants an ingest stored and
returns exactly the `{ src, widths }` every picture field in the format holds:

```jsonc
{
  "src": "/a/9f2c1ab40d3e7856bb91c204-w800.webp",
  "widths": [
    { "src": "/a/9f2c1ab40d3e7856bb91c204-w800.webp", "width": 800 },
    { "src": "/a/41d8e7b0c9a3251f6e0d4487-w1600.webp", "width": 1600 },
  ],
}
```

Three things about that shape are this capability's rules rather than the
format's taste.

**Every stored width is named.** Each is a separate content address, so one
cannot be derived from another, and a document that could hold only one would
leave the other counted against the event's variant budget and never served.

**`src` is the smallest.** It is the fallback a browser too old to read `srcset`
fetches, and that browser is on the slowest phone in the room.

**Keys, never URLs.** The hostname is applied at render time by
`resolveAssetSrc`, for the reason in "Which hostname" above.

Alt text is not here, and that is the split the format makes rather than an
omission: `contentPicture` carries alt because a photograph means something, and
alt is the buyer's words rather than anything an upload knows. The caller adds
it where the field has one.

It lives here rather than under `src/lib/template/` because the format knows
nothing about object stores, content addressing or variant labels, and this
module already knows all three. The dependency points one way and it imports
nothing from the format; `tests/unit/uploads/picture.test.ts` parses what it
returns with the format's own schema, which is the same arrangement `kinds.ts`
has with the migration carrying the same numbers.

The buyer interface that calls it is the guided form (`docs/editing.md`). It
sends the file on its own, before the save, and the form then carries the id of
the upload row rather than the address: an address in a form is an address a
browser can choose, and writing whatever `/a/<key>` it was handed into a buyer's
document would leave `claim_upload_objects` counting a reference nobody can see.
The server reads the row back as that buyer instead, so row level security is
what says the upload is theirs.

`tests/e2e/envelope.spec.ts` walks the chain over HTTP and
`tests/e2e/editing.spec.ts` walks it from the buyer's side, ending on the
`srcset` a guest is served.

## Retention, and the half Postgres cannot do

Uploads are buyer data, not guest data, so they follow the event rather than the
RSVP schedule, inside the sweep that already exists.

|                       | When                                             |
| --------------------- | ------------------------------------------------ |
| Originals discarded   | publication + 30 days                            |
| Derivatives discarded | grace ends, when the page stops serving for good |
| Rows deleted          | with the event, by the existing tier 2 purge     |

Postgres cannot make an HTTP request, so the database's job is to decide and it
records the decision in `platform.upload_objects`. `POST /api/uploads/sweep` is
the only thing that touches bytes, and it marks each key done as it goes so an
interrupted run resumes rather than losing the list.

`platform.upload_objects` carries no `owner_id`, which is the documented
exception to the rule in AGENTS.md and follows the precedent
`20260821010100_retention_over_answers.sql` set for `platform.retention_runs`.
Here it is not merely non-tenant data but structurally so: an object key is
shared between owners by construction, so an owner column would name whichever
of them happened to be second.

The plan warns that R2 deletion "is the kind of work that is silently skipped".
It has its own assertions: `tests/unit/uploads/sweep.test.ts` drives it against
a real store and asserts the bytes are gone and that nothing else was touched,
and `supabase/tests/09_uploads.test.sql` asserts that purging an event queues
its keys and that a key two events share is not claimed while either is live.

## Content responsibility

One paragraph, on `/terms`, and a mechanism behind every sentence in it. The
buyer warrants they hold the rights and indemnifies the platform; there is a
named address, a response time, a repeat infringer policy, and the ability to
**disable one asset without unpublishing an event**
(`public.disable_upload`, `DELETE /api/uploads/<id>`,
`scripts/takedown-upload.mjs`). `tests/unit/legal/uploads.test.ts` holds the
page's numbers to the code's.

Disabling deletes the bytes rather than hiding the row, and that is forced by
the caching decision rather than chosen: an immutable cache lifetime means no
header, flag or purge can un-serve an address somebody already holds. Removing
the object stops future fetches and reaches nothing already downloaded. The
terms say so rather than implying a recall that cannot happen.

## Running it with no cloud credential

Nothing here needs one. `supabase start`, `npm run dev`, and uploads go to
`.uploads/` and are served at `/a/<key>` by the app with the same headers R2
would carry. The whole suite, including the browser walk that reads the cache
headers off the wire and asserts `transferSize === 0` on a reload, runs that
way; CI runs it that way too.

`npm run build && CI=1 npm start` then `CI=1 npx playwright test` is what
exercises the caching assertions, which are skipped against the dev server
because its headers are not a production build's.
