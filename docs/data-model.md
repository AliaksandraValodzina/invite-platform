# Data model

Six tables from Phase 0.2, three more from stage 2, RLS from the first
migration, and the decisions that are expensive to change once real events
exist.

Migrations live in `supabase/migrations/` and are applied by the Supabase CLI.
Schema is never edited in the dashboard: a dashboard edit is a change nobody can
review and no environment can reproduce.

```
auth.users
   |
   +-- accounts            one per user, role ready for sellers
   +-- templates           definition (structure) + theme (tokens)
   |      |
   +-- events              activated instance, owns the public slug
          |
          +-- event_content    revisions, one published at a time
          +-- rsvp_questions   what this event asks
          +-- rsvps            the envelope of one reply
          |     |
          |     +-- rsvp_answers   what one guest said, guests PII
          +-- activation_codes.redeemed_event_id

platform.retention_runs    one row per retention sweep, no tenant
```

`platform` is a schema of its own, and that is a decision rather than tidiness.
Every table in `public` carries `owner_id` and belongs to a tenant, which
`01_tenancy.test.sql` asserts over the catalogue rather than over a list of
names. A sweep belongs to nobody, so giving it a nullable owner to satisfy the
shape would weaken the invariant for every other table. The schema is not in the
Data API's exposed list, so it has no HTTP surface at all.

## Tenancy

Every table carries `owner_id uuid not null references auth.users(id)`, and RLS
is enabled _and forced_ in the same migration that creates the table. v1 is
single-tenant; retrofitting tenancy is the most painful migration this kind of
product ever does, and the cost of carrying the column now is one column.

On `accounts`, `owner_id` points at the row's own auth user. That keeps one RLS
shape everywhere, `owner_id = (select auth.uid())`, with no special case to
remember. There is deliberately no `account_id` foreign key on the other tables:
two columns saying the same thing is two columns that can disagree.

On `event_content` and `rsvps`, `owner_id` is denormalised from the parent event
so the policy is a single-column comparison instead of a subquery on every read.
Denormalised means it can drift, so it is never taken from the caller: a BEFORE
trigger (`public.set_owner_from_event`) overwrites whatever was sent with the
event's real owner. The trigger runs as invoker, so a user who cannot see the
event gets `event does not exist` rather than a hint that it belongs to someone
else.

### Anonymous access is impossible, not merely unused

Guest pages and RSVP inserts go through API routes with the service role. `anon`
therefore needs nothing, and gets nothing, at three independent layers:

1. **Default privileges.** `20260819010000_lockdown_default_privileges.sql` runs
   before any table exists and revokes Supabase's default grants to `anon` for
   tables and sequences in `public`. No table added later can quietly inherit
   one.
2. **Explicit revoke.** Each table also does `revoke all on table ... from
public, anon`, so the guarantee is readable in the file that creates the
   table and does not depend on migration ordering.
3. **A restrictive policy.** Each table has `... as restrictive to anon using
(false) with check (false)`. Redundant today, because there is no permissive
   policy granting `anon` anything. It is there so that the day someone adds a
   permissive policy without a `to authenticated` clause, `anon` still gets
   nothing.

Functions follow the same rule: `execute` is revoked from `PUBLIC` and granted
only to the roles that need it. The retention functions are granted to
`service_role` alone.

Verified rather than asserted: `scripts/check-anon-access.mjs` drives a real
anonymous PostgREST client against a live stack and fails if it can read
`rsvps`, read `events`, or write either. It also proves that a signed-in user
who is not the owner sees nothing, which is the failure mode that a
single-tenant product finds out about in production.

### Who can do what

| Table              | `anon`  | `authenticated` owner                                  | `service_role` |
| ------------------ | ------- | ------------------------------------------------------ | -------------- |
| `accounts`         | nothing | select, update `display_name` and `contact_email` only | all            |
| `templates`        | nothing | full                                                   | all            |
| `events`           | nothing | full                                                   | all            |
| `event_content`    | nothing | full                                                   | all            |
| `rsvps`            | nothing | select, delete                                         | all            |
| `rsvp_questions`   | nothing | select, insert, update. **No delete**                  | all            |
| `rsvp_answers`     | nothing | select, delete                                         | all            |
| `activation_codes` | nothing | select, insert, update as issuer                       | all            |

Two of those need saying out loud.

`accounts.role` is not in the owner's `UPDATE` grant. RLS cannot restrict
columns, so column-level `GRANT` does it, and a trigger rejects a role change
from any role other than the service role even if a future migration hands the
privilege back. Self-service role escalation is the classic hole in a table
shaped like this.

`rsvps` and `rsvp_answers` give the buyer `select` and `delete` but no `insert`
or `update`, at both the privilege and the policy layer. Replies arrive through
an API route with the service role. Delete exists so an erasure request can be
honoured. A buyer editing what a guest wrote about their own allergies is not a
feature anyone asked for.

`rsvp_questions` gives the buyer no `delete` at all. Removing a question is
`retired_at`, because `rsvp_answers` references it `ON DELETE RESTRICT` and a
buyer tidying their form must never destroy replies somebody already gave. The
privilege system is what makes that true rather than a habit.

## Slugs

`events.slug` is the public URL. Once it is in a group chat it is permanent in
practice, because there is no way to reach those people to correct it.

**Minting.** `public.mint_event_slug(title)` returns the slugified title, capped
at 48 characters, plus a hyphen and six hex characters:
`sarah-and-toms-wedding-a3f91c`. The suffix is not a secret, since the page is
public by design, but it does three useful things: it removes the collision
retry from the common case, it stops `/e/` from being enumerable by guessing
couples' names, and it lets two `sarah-and-tom` weddings both have a nice URL.
Six hex characters is 16.7 million values per stem; the function retries ten
times against a unique index and raises rather than returning a duplicate.

`slugify` collapses anything outside `[a-z0-9]` to a single hyphen, so a title
in a non-Latin script can reduce to nothing. The fallback is the literal
`event`, not an error: a buyer must never be blocked from publishing because of
how their language transliterates. The random suffix is what keeps the result
unique.

The function is `SECURITY DEFINER` so its uniqueness check sees every row. Called
under RLS it would only see the caller's own events, cheerfully mint a slug
another owner already holds, and fail on insert. The only thing it leaks is
whether a public URL is taken, which anyone can learn by opening it.

**Uniqueness** is a plain unique index on `slug`. Global, not per owner, because
the URL is global.

**Permanence** is a trigger: changing `slug` on a row where `published_at` is not
null raises. Before publication a buyer can change it freely.

There is no reserved-slug table. Every event lives under `/e/<slug>`, so a slug
cannot collide with an application route by construction. That is a real
benefit of the URL shape and worth not giving up later.

## Event time

An event is a wall-clock promise: "Saturday at 3pm in Melbourne". It is not an
instant, and the difference matters.

- `starts_at_local timestamp` (no zone) and `time_zone text` (IANA name) are the
  **source of truth**.
- `starts_at_utc timestamptz` is a **derived cache**, recomputed by a BEFORE
  trigger on every write, kept only because sorting and range queries need an
  absolute instant.

If we stored only a `timestamptz`, then a government moving a DST boundary
between activation and the wedding, which happens somewhere every year, would
silently shift every affected countdown by an hour. Storing the local pair means
the answer is recomputed against the current tz database each time it is
resolved. This is also why `starts_at_utc` cannot be a generated column:
Postgres refuses, because `AT TIME ZONE` depends on the tz database rather than
on the row, which is exactly the property that makes it a cache and not a fact.

The zone is validated against `pg_catalog.pg_timezone_names` in the trigger
rather than a `CHECK`, because Postgres will not accept a non-`IMMUTABLE`
function in a check constraint. An unknown zone raises `22023`.

The countdown resolves `starts_at_local AT TIME ZONE time_zone` at read time.
Offsets are never stored: an offset is a fact about a moment, not about a place.

## Hosting expiry, and what a row looks like at each stage

Two explicit timestamps, no stored status. A status column would be wrong for
every row between the moment it expires and the moment a job notices, and events
expire at 3am on a Sunday.

- `hosting_expires_at` is the end of the paid term, computed at redemption from
  `activation_codes.hosting_months`.
- `grace_ends_at` defaults to `hosting_expires_at + 30 days`, filled by the
  trigger when the caller leaves it null, and constrained to be `>=
hosting_expires_at`.

What a guest gets is `public.event_state_at(status, hosting_expires_at,
grace_ends_at, now())`, a pure function so an API route, a test and a report all
give the same answer:

| Stage       | Condition                                   | Row                            | What is served                   |
| ----------- | ------------------------------------------- | ------------------------------ | -------------------------------- |
| unpublished | `status <> 'published'`                     | `published_at` may be null     | designed unpublished page        |
| live        | `now < hosting_expires_at`                  | untouched                      | full page, RSVPs open            |
| grace       | `hosting_expires_at <= now < grace_ends_at` | untouched                      | full page, RSVPs closed          |
| expired     | `now >= grace_ends_at`                      | untouched until retention runs | designed expiry page, no content |

The row itself does not change at any of those boundaries. Nothing is written
when an event expires. The first write that expiry causes is the retention
sweep, 30 days after grace ends.

Grace exists so that a link already shared into a chat does not break mid-event
because a renewal email went to spam. RSVPs close at `hosting_expires_at`
because collecting new guest PII against a lapsed account is not defensible.

## Replies

A reply is an envelope plus answers: `rsvps` holds attendance and party size,
which are never questions, and `rsvp_answers` holds what the guest wrote, one
row per question. What an event asks is rows in `rsvp_questions`, not template
config, and every question carries a `pii_class`.

The full design, and why a sixth question type is an addition rather than a
migration, is in `docs/replies.md`. Two properties belong here because they are
schema guarantees rather than product ones:

- **An answer snapshots its question.** `question_prompt`, `question_type` and
  `pii_class` are copied onto the answer at answer time, by the database, from
  the question row. A trigger refuses any later change to an answer except
  erasure. Rewording a question does not rewrite what anybody was asked.
- **Value columns are typed by shape** (`text`, `choice`, `number`) rather than by
  question type, which is what lets a new type land as an enum value and a
  branch. `scripts/prove-question-type-addition.mjs` performs that migration
  against a database holding answers and reads the catalogue to show nothing was
  rewritten.

## RSVP retention

Reply rows are other people's personal information, and none of those people are
our customer. Dietary notes are the sharp edge: "coeliac", "nut allergy", "no
pork" are health information and, read together, religious information.

**The rule.** A guest's identity leaves our database 30 days after the buyer's
grace period ends. The event itself is deleted a year after that.

| When                       | What happens                                                                              | What survives                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `grace_ends_at + 30 days`  | **Tier 1.** Every answer whose `pii_class` is not `none` is erased; `pii_redacted_at` set | `attendance`, `party_size`, `created_at`, `event_id`, and answers classed `none` |
| `grace_ends_at + 365 days` | **Tier 2.** Event row deleted                                                             | nothing; content revisions and RSVP rows cascade                                 |
| on request                 | guest erasure: `public.erase_rsvp(id)`, hard delete                                       | nothing                                                                          |
| on request                 | buyer account deletion: `on delete cascade` from `auth.users`                             | nothing                                                                          |

**Why redact and not delete at tier 1.** Deleting outright is the cleaner privacy
answer, but it destroys the buyer's record of their own event while they may
still want it, and buyers do come back asking how many people came. Redaction
gives the guest the thing that actually matters to them (they are no longer in a
stranger's database) and the buyer the thing that matters to them (a number).
Thirty days after the page stops serving is late enough that an export is
realistic and early enough that we are not sitting on a list of allergies for a
year.

**The sweep reads one enum column and never a prompt.** That is what `pii_class`
is for, and it is why the question set can grow without growing an unswept
corner of the database. An answer the buyer classed as being about nobody, such
as a menu choice, survives redaction, which is how a caterer's count outlives the
guest list.

**Redaction means something the database enforces.** A check constraint says an
answer either has `pii_redacted_at` null, or is classed `none`, or has every
value column null. A half-redacted row cannot exist, so a sweep that half-worked
fails loudly instead of leaving plausible-looking rows behind. A trigger also
refuses to add personal information to a reply already marked redacted.

**The sweep records that it ran** in `platform.retention_runs`. A sweep failing
since March looks exactly like a sweep with nothing to do; that row is what tells
them apart.

**Deliberately not collected**: IP address, user agent, device or referrer
fingerprint. Rate limiting on the RSVP endpoint belongs in the API route and does
not need to be written down in a table that outlives the party. Adding any of
them later means answering the retention question for them first, which is the
rule the whole table is built around: no field goes onto the RSVP form without a
stated fate at expiry.

**Lengths and counts are a privacy control**, not only validation. An answer is
capped at 2000 characters, a prompt at 200, and an event at twelve live
questions. The last one is the ceiling that has to exist before the authoring
surface does: an extensible question set with no limit is an unbounded personal
data surface.

**`activation_codes.order_reference`** is the Etsy order id. It is buyer data
rather than guest data, retained for the accounting period rather than this
schedule, and it is the one identifier here that intentionally outlives tier 2.

**Scheduling.** `public.run_retention_sweep()` runs both tiers in order and
returns a summary. See `20260819010900_schedule_retention.sql` for how it is
scheduled and what happens on an environment without `pg_cron`.

## Template and content documents

The template document is the product's file format. The split is enforced by the
schema, not left to convention:

- `templates.definition` is structure only: `{ version, blocks: [...] }` with
  per-block default content.
- `templates.theme` is tokens only: `{ version, tokens: {...} }` for palette,
  fonts, radii and spacing.

Two columns rather than one blob with two keys, because that separation is what
later lets a buyer pick a palette without touching structure. If they shared a
column, the first person in a hurry would nest content under a token key and
nobody would notice for a month. A check constraint rejects a `blocks` key
inside a theme document for the same reason.

`version` exists from day one and is stored twice: once inside the JSON, where
Zod reads it, and once as a column, so a query can find every event on an old
block set without unpacking JSON. A check constraint keeps them equal. It is
written as `CASE` and not `AND` because Postgres does not promise left-to-right
evaluation, and a cast in the wrong branch would raise an error instead of
failing the constraint.

The two documents version independently: adding a token is not the same change
as adding a block.

`events.template_definition_version` pins the definition version an event was
activated against, so evolving a block cannot change a page already shared into
a chat.

`event_content` holds **revisions**: one row per save, at most one with
`is_published` true, enforced by a partial unique index. A guest page reads the
published revision and nothing else, so a buyer can be mid-edit without a guest
seeing a half-finished page. A single row with draft and published columns is
the same amount of code and throws away every previous version, and "restore
what it said last week" is the request that arrives the day after a bad edit.

Its two documents are written by one function, `public.save_event_content`, and
either may be left out of a call and is then carried forward from the revision
being replaced. That is what lets the words save leave a buyer's palette alone
and the palette save leave their words alone while both still write one whole
new published revision. The buyer's section order lives inside `content`
alongside their words for the same reason: a reorder is then one transaction, so
no guest can read a page with half of one applied. `docs/composition.md`.

## Enums

Enums start small. Adding a value is `alter type ... add value`, which is cheap;
removing one is not.

States that are a function of the clock are not stored anywhere. `event_status`
is publication, which a buyer controls; expiry is derived. `activation_code_status`
has no `expired` value for the same reason.

## Activation codes

The redemption flow is Phase 1. The schema is here now because a redeemable
token is a thing you want stored correctly from the first row, not migrated once
ten thousand of them are in customers' hands.

Codes are stored as `sha256(normalised_code)` in `code_hash`, never in
plaintext. A code is a bearer token: whoever has the string can claim a paid
activation, so a database dump should not hand someone a stack of free
invitations. Normalisation strips separators and uppercases, so `abcd-1234` and
`ABCD1234` are the same code, which is what buyers actually type.

`code_prefix` keeps the first four characters in the clear so support can find a
code a buyer is reading out over email. Four characters is not enough to guess
the rest.

This is the one decision here that trades support ergonomics for security and is
worth re-opening if it hurts: reversing it is a one-column migration, whereas
leaking a code list is not reversible at all.

Redemption is all-or-nothing, enforced by a constraint: a row with status
`redeemed` has a redeemer, a timestamp and an event, and a row without status
`redeemed` has none of them.

## Testing the schema

Two suites, because they prove different things.

`supabase/tests/*.test.sql` are pgTAP, run by `supabase test db`. They cover
constraints, triggers, derived time, slug behaviour, the reply model, the write
function, the retention sweeps, and that RLS is enabled and forced on every
table. The assertions about the reply model are written as attempts to break the
rule, because a test that only exercises the happy path passes against a table
with the constraint dropped.

`scripts/check-anon-access.mjs` is the one that matters most. It drives real
HTTP clients (anonymous, and a signed-in non-owner) against a running stack
through PostgREST and the auth API, which is the path an attacker actually has.
A pgTAP `SET ROLE anon` proves the database is configured; this proves the
product is. It needs a live Supabase, local or staging, and takes its
credentials from the environment or from `supabase status`.
