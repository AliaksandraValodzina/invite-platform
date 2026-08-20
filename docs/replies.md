# Replies

Stage 2. A guest can reply, and the buyer can read it back. It is also the first
guest personal information this product holds, which is why the privacy
statement ships in this stage rather than a later one.

Schema is `supabase/migrations/2026082101*.sql`. The question model shared by
everything is `src/lib/rsvp/questions.ts`. The write path is
`src/lib/rsvp/handle.ts`. The read-back is `src/app/dashboard/`.

## A reply is an envelope plus answers

```
rsvps            attendance, party_size          the envelope
  |
  +-- rsvp_answers   one row per question answered
        |
        +-- rsvp_questions   what this event asks
```

**Attendance and party size are not questions.** Neither is ever optional, and
the headcount query must not depend on which questions an event happens to ask.
`sum(party_size) where attendance = 'attending'` is the number a caterer wants,
with no special case, whatever the form looks like.

**Everything a guest writes is an answer to a question.** Questions are rows, not
template config, and each one carries a `pii_class`. That is what makes the
question set extensible without making the personal data surface unbounded.

## Why the answer model exists now

Five question types ship: `short_answer`, `long_answer`, `multiple_choice`,
`checkbox`, `email`. A sixth has to be an addition rather than a migration, and
that is not a property four fixed columns can have. Doing it later, once a
thousand events hold real guest replies, is a data migration over other people's
personal information; doing it before the first row exists costs nothing.

**Value columns are typed by shape, not by question type.**

| Shape    | Column         | Types that use it                |
| -------- | -------------- | -------------------------------- |
| `text`   | `value_text`   | short_answer, long_answer, email |
| `choice` | `value_choice` | multiple_choice, checkbox        |
| `number` | `value_number` | none yet, and that is the point  |

`public.rsvp_answer_shape(type)` is the one map, and `RSVP_ANSWER_SHAPES` in
`src/lib/rsvp/questions.ts` mirrors it.
`tests/unit/rsvp/schema-agreement.test.ts` reads the migration and fails if the
two disagree.

So a sixth type is: one `alter type ... add value`, one branch in that function,
one reader in `src/lib/rsvp/submission.ts`, one branch in the form's control
switch. No table changes and no row moves.

**That is shown, not asserted.** `scripts/prove-question-type-addition.mjs` seeds
an event with a reply answering every shipped type, records the relfilenode of
both tables, the full column list, the constraint list and the `xmin` of every
answer row, applies the whole candidate migration, and reads all four back. It
then stores an answer of the new type in `value_number`, the column no shipped
type uses. CI runs it on every pull request. It refuses to run against anything
but a local database, because an enum value cannot be un-added.

`tests/unit/rsvp/sixth-type.test.ts` does the app half the same way: it builds a
genuinely sixth type on top of the readers that actually shipped and runs a real
submission through the same function the product runs.

## Two rules the schema enforces, so the app cannot forget them

**A reply is an immutable record of what was answered at the time.**
`question_prompt`, `question_type` and `pii_class` are snapshotted onto the
answer when it is stored, from the question row rather than from the caller. A
`BEFORE UPDATE` trigger refuses any change to an answer except erasure. Rewording
a question tomorrow does not rewrite what anybody was asked.

**Deleting a question retires it.** `rsvp_answers.question_id` references
`rsvp_questions` `ON DELETE RESTRICT`, and `authenticated` holds no `DELETE`
privilege on that table at all. A buyer tidying their form cannot destroy replies
somebody already gave: the cascade is impossible rather than discouraged.
Removal is `retired_at`, and a retired question keeps its column on the
dashboard, marked "no longer asked", so its answers stay legible.

## `pii_class` is the load bearing column

`none | identity | contact | sensitive`, declared on the question and copied onto
every answer.

It is what lets the retention sweep know what to erase **without reading the
prompt**. Without it, an extensible question set is an unbounded personal data
surface and the database-enforced redaction guarantee stops meaning anything.

Only `none` is treated differently by the sweep: everything else is erased on the
same day. The finer classes are what the privacy statement describes, what a
buyer declares when they add a question, and what a rule that later treats
sensitive data differently would select on.

The default question set and its classes are in `src/lib/rsvp/questions.ts`:

| Question        | Type            | Class       | Survives redaction |
| --------------- | --------------- | ----------- | ------------------ |
| Your name       | short_answer    | `identity`  | no                 |
| Email           | email           | `contact`   | no                 |
| Dietary         | long_answer     | `sensitive` | no                 |
| A note          | long_answer     | `identity`  | no                 |
| _a menu choice_ | multiple_choice | `none`      | yes                |

A free-text note is classed `identity` because it is written by a named person
and in practice contains names, plans and family news. Classing it `none` to keep
it past redaction would be the whole control undone by one convenient decision.

## Redaction is enforced by the database

Two check constraints on `rsvp_answers`:

- `rsvp_answers_redaction_is_complete`: either nothing is redacted, or the class
  is `none`, or **every** value column is null.
- `rsvp_answers_carry_one_value`: an answer holds exactly one value until it is
  redacted.

And a trigger refuses to add personal information to a reply whose envelope is
already marked redacted, so the timestamp is a statement about the row rather
than about a moment.

`supabase/tests/07_rsvp_answers.test.sql` attempts each violation. Every
assertion there is written as an attempt to break the rule, because a test that
only exercises the happy path passes against a table with the constraint dropped.

The sweep itself is `public.redact_expired_rsvp_pii`, and
`platform.retention_runs` records every run: a sweep that has been failing since
March looks exactly like a sweep with nothing to do, and that row is what tells
them apart.

## The write path

```
guest page form  ->  server action  ->  handleRsvpSubmission  ->  public.submit_rsvp
POST /api/e/<slug>/rsvp  ------------->  (same function)
```

Two doors, one implementation. The route is the contract the build plan names and
what a client that is not this app would use; the guest page's form calls the
same function through a server action, because the form is a client component in
this app and a second HTTP hop to our own origin buys nothing.

In order:

1. **Rate limit**, before the database is touched. In memory, keyed by a hash of
   the caller's address and the slug, never persisted.
   `20260819010600_rsvps.sql` is explicit that abuse control here is a limit in
   the route and not a column in a table that outlives the party.
2. **The event, read fresh.** `revalidate: false`. The guest page may be up to a
   minute out of date about whether replies are open, deliberately; a request
   about to store somebody's name may not be.
3. **The honeypot**, before any validation message could tell a script which of
   its fields was wrong. A filled honeypot gets the same answer a real reply
   gets, and nothing is stored.
4. **Validation**, with messages scoped to the field they belong to.
5. **`public.submit_rsvp`**, one transaction. It re-reads the serving state
   inside that transaction, so a cached page cannot collect a reply against
   lapsed hosting. It snapshots the prompt, type and class from the question row
   rather than from the caller. An answer naming another event's question is
   refused; an answer to a question retired since the page loaded is skipped, so
   a buyer's edit does not cost a guest their whole reply.

Two tables in one transaction is the reason it is a database function rather
than two PostgREST inserts. Two requests can half succeed, and the half that
succeeds is the envelope: the buyer would open their dashboard and find a reply
from nobody.

## Reading it back

`/dashboard` lists the buyer's events with a reply count and a head count.
`/dashboard/<id>/replies` is one row per reply and one column per question the
event has ever asked. `/dashboard/<id>/replies/export` is the same as a CSV.

**The dashboard reads as the buyer, not as the service role.** It sends their own
token, so the check is row level security in the database and not a `where`
clause somebody can forget. A bug in `src/lib/supabase/buyer.ts` can show a buyer
nothing; it cannot show them somebody else's replies.

**A redacted answer reads "erased", not blank.** Blank would say the guest did not
answer. Erased says the promise in the privacy statement was kept.

**The CSV disarms formulas.** A cell beginning `=`, `+`, `-` or `@` is prefixed
with an apostrophe, because a spreadsheet treats those as formulas and some will
run them. A guest typing `=HYPERLINK(...)` into a dietary note is writing into the
buyer's spreadsheet. `tests/unit/dashboard/csv.test.ts` writes the attack rather
than describing it.

## Signing in

Magic link, no password. A buyer arrives once from an Etsy order and comes back
three times over a year, which is exactly the interval at which everybody resets
a password.

`/login` asks the auth API for a link and always answers the same way, whether or
not the address has an account: `should_create_user: false` means an unknown
address does not quietly become one, and the answer does not tell a stranger
which of their guesses is a customer. `/auth/callback` exchanges the one-use hash
for a session and writes two HTTP-only cookies. `src/proxy.ts` refreshes the
access token when it has expired, because a server component cannot set a cookie
and a buyer's token expires every hour.

**Every redirect on the session path uses a relative `Location`.** An absolute one
built from `request.url` can name a different host from the one the cookies were
just set for, which lands a signed-in browser on the sign-in page. That is
measured rather than guessed: the browser suite caught it the first time it ran.

## Caching, which is the opposite decision from the guest page

| Route           | Header                                                                        | Why                                  |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| `/e/<slug>`     | `public, max-age=0, s-maxage=60, stale-while-revalidate=300, must-revalidate` | a link in a group chat is one render |
| `/dashboard/*`  | `private, no-store, max-age=0, must-revalidate`                               | other people's names, for one person |
| `/api/e/*/rsvp` | `no-store`                                                                    | a write                              |

Both are set in `src/proxy.ts` and both are read off the wire by
`tests/e2e/caching.spec.ts`, which refuses to run against the dev server.

## Still owed

- **Email delivery.** Supabase Auth's built-in sender is rate limited and not for
  production. Point it at Resend or Postmark with SPF, DKIM and DMARC on the real
  domain, and warm it up. AGENTS.md forbids raw SMTP. Nothing in this repo holds
  a key for it.
- **The refusal list** for prompts asking for government identifiers, payment
  details or health information beyond dietary. The terms state the obligation
  and the schema caps question count and prompt length; the check belongs in the
  authoring path, which is stage 3.
- **A guest-facing erasure route.** Today an erasure request is an address in the
  privacy statement plus `public.erase_rsvp(id)` run by an operator, which is what
  the build plan asks for at this stage. Self-serve can follow.
- **An alert on a missing sweep.** `platform.retention_runs` holds the rows; the
  thing that notices a day with no row does not exist yet.
- **A second person on the buyer's side.** A couple sharing an event shares one
  login. Every table already carries `owner_id`, so a collaborators table later
  is survivable, but "my partner cannot see the replies" is a support ticket that
  will arrive.

## Running it locally

Nothing here needs a hosted account.

```bash
supabase start
cp .env.example .env.local          # paste in what `supabase status` prints
node scripts/seed-event.ts --title "Emma & Jake" --starts 2027-03-14T16:00:00
npm run dev                         # reply at /e/<slug>

# then sign in as the buyer, without a mailbox:
#   POST /auth/v1/admin/generate_link with the service role key, and open
#   /auth/callback?token_hash=<hashed_token>
# which is exactly what tests/support/auth.ts does.
```
