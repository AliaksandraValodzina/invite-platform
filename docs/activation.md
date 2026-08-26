# Activation

Stage 3. An Etsy order becomes a live invitation with the captain not in the
middle. It is the point where this stops being a service somebody delivers by
hand and becomes a product.

The code is `src/lib/activation/` (pure and service role), `src/app/claim/[code]/`
(the single use link), `src/app/t/[templateId]/` (the public preview) and
`src/app/t/[templateId]/use/` (the free launch's open copy link),
`scripts/issue-codes.ts` (what the captain runs), and the publish and confirm
halves of `src/app/dashboard/[id]/edit/`. Start at `docs/data-model.md` for what
an activation code is, and `docs/editing.md` for what a buyer does after they
have one.

## Three links, and they must never be conflated

| Link                  | What it does                                                   | Who may hold it                                                              |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/t/<templateId>`     | Renders a template read only. Copies nothing, creates nothing. | Anybody. It belongs in the Etsy listing and on social, and it should spread. |
| `/t/<templateId>/use` | Creates the visitor's own copy, behind sign-in. Not spent.     | Anybody. **Free launch only.** See the gate below.                           |
| `/claim/<code>`       | Creates the buyer's own copy, then is spent.                   | One buyer, delivered in the Etsy order message.                              |

They are separate files, separate reads and separate cache headers.
`tests/e2e/activation.spec.ts` asserts of the preview that the events table did
not grow, and `tests/e2e/open-copy-link.spec.ts` walks the copy link.

### Why the middle row exists, and why it used to be forbidden

This document used to say an open "use this template" link was wrong here, and
the argument was sound: Canva can afford open template links because it
monetises a subscription, and here the invitation **is** the purchase, so an
open copy link turns one sale into unlimited invitations. These URLs travel too:
a buyer who posts their own invitation publicly has posted its address.

The captain's decision on 2026-08-24 was _"LET'S MAKE one link for all for
now"_, paired with releasing the first template **free**. Free changes the
arithmetic rather than the reasoning. Nothing is being sold, so a free copy
costs nothing, and a link that has to stay secret to be safe is not a link you
can put on an Etsy listing.

### The gate this route is not allowed to outlive

**`/t/<templateId>/use` must not still be the active route when the first PAID
listing publishes.** An open copy link plus a price is a free product.
`ip-decision-order-verification` is the captain-held decision that replaces it
and it is still open. This is why `/claim/<code>`, `scripts/issue-codes.ts` and
the `activation_codes` table are untouched: they are the paid route the day the
captain charges, and deleting them because they are currently unused would be
the expensive kind of tidying.

The route says so in `src/app/t/[templateId]/use/page.tsx` and
`src/lib/activation/copy.ts`, which is where somebody about to change it will be
standing.

### What the copy link does and does not have

It has no code, so there is nothing to spend, nothing to mark used and nothing
to be idempotent about. Pressing it twice is two copies, deliberately: copies
and drafts are unlimited by the same decision that opened the link, and two
people planning two weddings from one design is the product working. That is
the opposite of the claim link, where a second tap must open the invitation
somebody already paid for.

Both doors mint the same thing through `src/lib/activation/mint.ts`: a draft
event, its question set from `defaultQuestionRows`, and content revision 1. One
module rather than two, because the first thing that would drift between two
copies of that list is a `pii_class`, which decides what the retention sweep
erases.

A free copy is created with `basic` tier and twelve months of hosting
(`FREE_COPY_HOSTING_MONTHS`), the same term `scripts/issue-codes.ts` defaults a
paid code to. `basic` because it came from no listing at all, and twelve months
because a shorter one would be a different promise that nobody has made.

### Two things that have to be true when somebody arrives

**A visitor who is not signed in still sees the invitation.** The preview is the
sales pitch, and sign-in in front of it is a door in front of the shop window.
That is why copying is a second route rather than a branch inside the first: a
page that rendered differently for a signed-in visitor could not be served from
an edge, and `/t/<templateId>` is `public, s-maxage=300` precisely because it
carries nothing about anybody.

**Signing in to copy returns them to the copy, not to a dashboard.** Same two
carriers as a claim, same allow list, same cookie: `src/lib/auth/destination.ts`
admits `/t/<templateId>/use` alongside `/claim/<code>`. Losing a claim across
the mailbox costs a purchase; losing a copy costs the person, because nobody
presses "make this mine" twice.

### The limit that now carries the whole weight

**One published invitation at a time per account**, unlimited drafts and copies,
the captain's decision of 2026-08-24. With an open copy link that limit is the
only thing between one free template and somebody running a wedding business on
it, because every published event costs hosting for its full term and a draft
costs nothing.

It is enforced in the database by `public.events_publish_limit`
(`20260826010000_one_published_invitation.sql`), not in the publish button, and
the reason is the one AGENTS.md already gives for upload caps: a check in front
of a write can be raced, and two tabs pressing Publish are two transactions that
each see no published row under READ COMMITTED. The trigger takes an advisory
lock on the owner before it looks. A buyer holds their own access token and
could send `PATCH /events` with `{"status":"published"}` at PostgREST with no
page in the middle, so the rule fires on any write by `authenticated` rather
than only on the route.

The rule's boundary is stated rather than discovered: the platform's own service
role is outside it, because seeding the four serving-state fixtures and a
support action putting somebody's second page back up are decisions a person
made with the platform's key, not a buyer dodging a limit.
`supabase/tests/11_publish_limit.test.sql` asserts both the rule and the
boundary.

The editor asks before it offers the button, so a buyer whose account already
has a live invitation is told which one is in the way and that taking it down is
the way through (`src/lib/editor/publish-limit.ts`). That read is the sentence,
never the enforcement.

## The claim link is the code

The captain's decision on 2026-08-23: the buyer clicks a link and never types a
code.

That needed no schema change, and it is worth being precise about why.
`20260819010700_activation_codes.sql` already describes a code as "a bearer
token: whoever has the string can claim a paid activation". A URL is a way of
carrying a string. So `/claim/AB4CD-9EFGH-JKMNP-QRSTV` is the same code a buyer
could have typed, and `public.hash_activation_code` strips separators and
uppercases before hashing, which makes the dashes decoration. They exist for the
one case where a link fails and somebody reads the thing out.

The alphabet is Crockford's base32, which already leaves out I, L, O and U.
Twenty characters is 100 bits, and that is the number that matters: a claim URL
is guessable in exactly the way a password is.

**The app never hashes a code itself.** `src/lib/activation/claim.ts` asks the
database through `rpc/hash_activation_code`, and so does the issuing script.
Two implementations of "strip and uppercase" would eventually disagree about
some character nobody thought about, and the symptom would be a paid code that
is not found. `src/lib/activation/code.ts` has a normaliser, but it only decides
whether a URL segment is worth a database round trip and how to word a refusal;
`tests/unit/activation/schema-agreement.test.ts` holds it to the migration.

## The two places this flow breaks

### 1. The token has to survive sign-in

Click the link, not signed in, magic link round trip, and the copy must still be
created. Lose the token in the middle and the buyer arrives signed in at an
empty dashboard, which to them means they paid and received nothing.

The claim is carried twice, by two mechanisms that fail differently
(`src/lib/auth/destination.ts`):

- **`?next=` on the callback URL** travels inside the link, so it survives a
  buyer who asks on a laptop and opens the mail on a phone. It can be lost to a
  mail provider that rewrites links, and to a deployment whose auth redirect
  allow list does not admit a query string.
- **the `ip_claim` cookie** is set on the device that asked, so it survives
  anything done to the URL. It cannot cross devices. It is written **before**
  the send rather than after, because it is a note about what this browser was
  in the middle of and that is true whether or not the mail went out.

`?next=` wins when both are present, because it is the link the buyer actually
opened. Neither is trusted further than an allow list of the two shapes this
product produces: a `next` parameter is an open redirect unless something
refuses to follow it off the site, and "starts with a slash" is not that
something.

**A deployment has to allow the callback with its query string.** GoTrue
compares a redirect against `site_url` for equality and against
`additional_redirect_urls` by pattern, so without a pattern admitting a path and
a query it falls back to `site_url` and silently drops the claim. The local
stack's entry is in `supabase/config.toml`; a hosted project needs the same in
its auth settings.

### 2. A second click must be safe

A double tap on a phone is two requests, and neither may show a spent-code error
about something somebody just paid for. Three mechanisms, in the order they
fire:

1. **The row is read first.** A code that is already redeemed resolves to
   `redeemed_event_id` and nothing is written. This is the common case: the
   second click a minute later, or a week later.
2. **The claim is a compare and set.**
   `activation_codes?id=eq.<id>&status=eq.issued` under
   `Prefer: return=representation` returns the row to exactly one caller,
   because Postgres re-evaluates the filter after taking the row lock. The loser
   gets an empty array rather than an error.
3. **The loser takes its own event back** and resolves to the winner's. That is
   the only DELETE in this application, and it can only reach a row this request
   created seconds earlier that no reply can have touched.

The event is created before the code is spent, not the other way round, because
`activation_codes_redemption_is_complete` requires a redeemed row to name its
event. That ordering is what makes step 3 necessary and it is the cheaper half
of the trade: an event nobody can reach is recoverable, and a code marked spent
with no event is not.

## Claiming happens on the GET, and why that is not reckless

Creating a row while rendering a page is not something to do casually. Two
questions answer it.

**Can anything but the buyer trigger it?** No. A claim needs a signed-in
session, so the link scanners and preview fetchers that open URLs out of emails
and chat apps reach the signed-out branch and write nothing. The mailbox is the
deliberate act and nothing but the buyer has it.

**What does a repeated GET do?** The same thing as the first, which is the
requirement above rather than a happy accident.

Given both, a confirmation step between the link and the editor would buy
nothing and cost the thing that was asked for: the buyer clicks a link and is in
their invitation, Canva-style, having typed no code.

## Signing in from a claim link, or from the copy link, creates the account

`/login` asks the auth API with `should_create_user: false`, because an address
typed into a form is not evidence of anything. Two pages ask with it true, and
they are the two authorisations this product recognises for becoming a customer:

- **holding an unspent activation**, on `/claim/<code>`
- **a published template offered free**, on `/t/<templateId>/use`

The second is the free launch's, and it is the half of that route which also has
to be taken back when the first paid listing publishes, not just the copy
button. In both cases the thing that authorises it is re-read inside the action
rather than trusted from the page that rendered the form, because a server
action is a POST endpoint reachable directly. On the copy link that matters for
a specific reason: a template id is not a secret, so a template nobody has
published must create no account.

A code that is spent, revoked or lapsed still gets a sign-in link, because the
person holding it may well have an account already and the answer they need is
on the other side of signing in. It just does not get an account created for it.

## What a spent code creates

From the template the code names: an event row, its question set, and content
revision 1, published and empty.

- **Draft, always.** An invitation carrying a placeholder date and the
  template's example names is not something to put in front of a guest.
- **A placeholder date**, 180 days out at four in the afternoon, in `Etc/UTC`.
  Two gates have to be cleared and they are not the same gate:
  `pg_timezone_names` contains bare `UTC` and this app's `isSupportedTimeZone`
  requires an `Area/Location` name, because the countdown resolves through
  `Intl`. Bare `UTC` inserts happily and then leaves the buyer's own page
  serving a "could not be loaded" notice. `tests/unit/activation/claim-defaults.test.ts`
  holds the placeholder to both.
- **`hosting_expires_at` from `hosting_months` on the code**, so a promotion can
  vary the term without a schema change. Month arithmetic clamps into the target
  month: twelve months bought on 31 January ends in February, not on 3 March.
  `grace_ends_at` is not sent, because `events_before_write` defaults it.
- **The question set from `defaultQuestionRows`**, the same list
  `scripts/seed-event.ts` uses. The first thing that would drift between two
  copies of that list is a `pii_class`, which decides what the retention sweep
  erases.

Whether a buyer may write their own RSVP questions is still the open captain
decision `ip-product-plan-decision-rsvp-question-freedom`, and nothing here
answers it.

## The slug follows the title until publication

A code is spent before the buyer has typed anything, so the event is created
under "Your invitation" and the slug minted from it says
`your-invitation-a1b2c3`. Letting it follow the title until the event is
published turns that into `wilhelmina-and-bartholomew-a1b2c3` in the WhatsApp
preview, which is the first impression of the product.

Publishing freezes it. `events_before_write` refuses a slug change once
`published_at` is set and keeps `published_at` at the FIRST publication, so
unpublishing does not hand the link back. Before that moment nobody holds the
link: the page serves the designed "not published" notice to anyone who tries
it.

## Publishing

One column, `events.status`, and no second opinion about it anywhere. Which of
the four states a guest gets is `public.event_state_at` reading that column
alongside the two expiry timestamps, and nothing in this application compares
those a second time (`docs/serving.md`).

Unpublishing is a real button and not a hidden one. A buyer who put the wrong
date in front of two hundred people needs to be able to take the page down
inside a minute, and the alternative to a button is an email to the captain,
which is the thing this whole stage exists to remove.

## The load bearing detail warning

The captain's answer 5, and not optional. Before saving a change that touches
`events.starts_at_local`, `events.time_zone`, or the map block's `venueName` or
`address`, the reply count is read and, if there are any, the save stops and
asks. **Nothing is sent to guests either way, and the buyer may go ahead: it is
a confirmation and never a block.**

`src/lib/editor/load-bearing.ts` holds the list. It is data rather than a chain
of conditions, so adding "the dress code once invitations have gone out" later
is one line. **It cannot be derived from the format**, and that is worth stating
rather than apologising for: a schema says what a field is shaped like, and
nothing in it can say that somebody has already booked a flight around the
answer. That is a fact about people, not about types.

Three details of the comparison, each of which was a bug first:

- It compares **merged configs**, not overrides. A buyer who deletes their
  override for a venue name has not left the venue alone: the page falls back to
  the template's default and the address on screen changes.
- It **normalises line endings**. A textarea posts every newline as CRLF, so an
  address stored with bare newlines comes back "changed" the first time a buyer
  saves anything at all on that form. The confirmation would then say the
  address changes from an address to the identical address, on a page whose
  whole job is to be believed.
- A count that **could not be read** asks anyway, and says so without naming a
  number. Being asked about a change nobody had replied to costs one press;
  moving a venue under twelve people without asking is what this exists to
  prevent.

### How the pending save survives the question

React resets an uncontrolled form after a form action returns. That is right for
a save and wrong for a question: the buyer's new date would snap back to the old
one while they are being asked whether to change it, and the second press would
then save what was already stored.

So the action hands the whole submitted form back as one string, the form
renders it as one hidden field, and confirming replays it
(`encodeReplay`/`replayedForm` in `src/lib/editor/result.ts`). One field rather
than one hidden input per value, because per-value inputs would sit in the same
form as the visible controls under the same names and `FormData.get` would have
to choose between two answers by document order.

The visible controls do revert while the question is on screen, which is why the
panel states the change as **from** and **to** rather than pointing at the
fields above it. What gets written is the replay, so the sentence in the panel
is the accurate description of what the button does and the field above it is
not.

## The one place the editor uses the service role

`src/lib/supabase/editing.ts` reads and writes as the buyer, so row level
security is the check, with exactly one exception: the template's `definition`
and `theme` are read with the service role.

The reason is real rather than an oversight. `templates` has one policy,
`owner_id = auth.uid()`, and **a buyer does not own the template they
activated**: the seller does. `20260819010300_templates.sql` says as much and
defers the question ("When a real catalogue exists it gets a policy written
against that requirement rather than a guess at it now"). Before this stage no
event existed whose template belonged to somebody else, so nothing had noticed.

The split holds the guarantee that matters. Which event this is, and whether it
is the buyer's, is still a row level security decision; the second read is keyed
by an id the database just handed that buyer and returns two JSON documents with
no owner, no key and nothing of anybody's. A bug there can show a buyer the
wrong design. It cannot show them another buyer's wedding.

**The alternative is a schema change and is probably the better long term
answer**: a select policy on `templates` for `authenticated`. It has to cover
more than "published", because a buyer whose template is later unpublished must
still be able to edit their own invitation, so it is a policy with an `exists`
over `events` in it. That is a decision about the catalogue rather than about
activation, and it belongs to whoever builds one.

## Issuing codes

```
node scripts/issue-codes.ts --template <key|id> [--count 1] [--hosting-months 12] \
  [--order <etsy order id>] [--expires 2027-01-31T00:00:00Z] [--out ./codes.txt]
```

It prints the preview link, the claim links, and the four character support
prefix for each. **The plaintext is printed once and is not stored anywhere**;
that is the whole security model of a bearer token, and losing the output means
minting new codes and revoking the old ones. `--out` writes them to a file,
which is then a list of unspent purchases and should be treated as one.

`owner_id` on a code is the ISSUER, never the redeemer, which is the seam that
lets a seller issue their own codes later without a migration. A code for an
unpublished template is refused, because its preview link would 404.

Every link is built from `NEXT_PUBLIC_SITE_URL` through `readSiteConfig`. **The
product has no name yet, so no host is hardcoded anywhere**: with the variable
unset the script falls back and says so in its output.

## Caching

`/claim/*` is `private, no-store`, set in `src/proxy.ts` alongside the
dashboard's. A claim URL carries a bearer token in its path and the response
says whether that token is still worth anything, so no shared cache may hold it.
The route is in the proxy's matcher for a second reason too: a buyer who claimed
one invitation in March and clicks a second link in September arrives with an
hour-old access token, and without the refresh they would be asked for their
email again, which on a paid link reads as the purchase not being recognised.

`/t/*` is the opposite decision, for the opposite reason: it carries nothing
about anybody, so `public, s-maxage=300` with an hour of stale. `/t/<id>/use`
sits one segment inside that prefix and needs the exact opposite header, which
is the shape of mistake a prefix rule makes silently, so `src/proxy.ts` matches
it first and `tests/e2e/caching.spec.ts` reads both off the wire. A cached copy
link would serve one visitor's answer to the next. The explicit
stale window is not decoration. Next's own default for a route like this is
nearly a year, which would leave a design corrected on Monday still on screen in
the spring.

**A route only reaches the cached path at all if it exports
`generateStaticParams`.** Without one, Next renders every request fresh and
streams it, and what comes off the wire is `private, no-store` however confident
the `revalidate` export looks. Measured on a production build, for both this
route and the guest page.

## Tests

`tests/e2e/activation.spec.ts` walks the loop: the signed-out claim through
sign-in, the claim surviving a link that lost its query, the second click, the
genuine double tap as two concurrent requests, a link claimed on another
account, the public preview creating nothing, publish and unpublish seen from
the guest side, and the confirmation.

`tests/e2e/open-copy-link.spec.ts` walks the copy link: the signed-out preview
with its call to action, the copy route creating nothing before sign-in, the
sign-in landing in the visitor's own editor rather than a dashboard, the cookie
carrier when the link loses its query, two presses making two copies, and the
published-invitation limit refusing a second publish on a page that was
rendered when it still looked possible.

`tests/unit/activation/` covers the code format, the hosting arithmetic, the
placeholder both gates have to accept, and the agreement with the migration.
`tests/unit/dashboard/publish-limit.test.ts` holds the sentence the route
matches to the sentence the migration raises.
`tests/unit/auth/destination.test.ts` covers the two carriers and the open
redirect refusals. `tests/unit/editor/load-bearing.test.ts` covers the list, the
comparison and the replay.

`scripts/check-anon-access.mjs` seeds a real unspent code and proves, over HTTP,
that an anonymous client cannot read it or hash one, and that a signed-in
stranger cannot spend it. The row is read back afterwards rather than the
refusal trusted.

**What the browser suite does not cover**, and it is worth naming: that the auth
API accepted the send. The local stack has no mailer, so the specs mint the
one-use hash through the admin API and open the real callback, exactly as the
rest of the suite does. The decision that could be wrong, which value of
`should_create_user` a given code state gets, is in
`src/app/claim/[code]/actions.ts`.
