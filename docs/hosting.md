# Hosting

How this app is deployed, what each environment variable is for, and the three
faults that a first deployment walked into. It is written so that somebody
putting this on a second host, or on a new Vercel project, does not have to
rediscover any of it.

Nothing here names a hosted project, a database region, a project reference or
a key. Those live in the deployment's own settings and in the captain's hands,
for the reasons `AGENTS.md` gives.

## Where the deployment shape is written down

`vercel.json`, and that is deliberate. The project's dashboard had its framework
preset set to **Other**, which meant every production deployment published the
`public/` directory as a static site: the build finished in twenty seconds, the
deployment went green, and the site answered **404 at its own root**. Nothing in
the repository disagreed with that, because nothing in the repository said
anything about it at all.

The rule is the same one `AGENTS.md` states for schema. A setting only a
dashboard knows is a setting nobody can review and no environment can
reproduce. `vercel.json` overrides the dashboard, so the preset cannot drift
back.

`regions` is a single region matching the database's, because a function
reading a database on another continent pays a round trip per query on a page a
guest opens on phone data. One region is also all the free tier offers, which
makes the choice cheap to state and free to make.

## Environment variables, and which side of the wire each one lives on

Vercel reads neither `.env.local` nor anything in this repository. Every
variable below is set in the project's environment settings, per environment.

| Variable                      | Needed by                                                                                 | Public?                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL`        | canonical and OG URLs, the magic-link callback, the links `scripts/issue-codes.ts` prints | the origin is, and it is meant to be             |
| `SUPABASE_URL`                | `src/lib/supabase/service.ts`, `src/lib/auth/config.ts`                                   | no, and it does not need to be                   |
| `SUPABASE_ANON_KEY`           | `src/lib/auth/config.ts`, for signing a buyer in                                          | grants nothing on its own, but still server side |
| `SUPABASE_SERVICE_ROLE_KEY`   | `src/lib/supabase/service.ts`                                                             | **never**. It bypasses row level security        |
| `NEXT_PUBLIC_DATA_REGION`     | the sentence `/privacy` prints about where replies are stored                             | yes                                              |
| `NEXT_PUBLIC_PRIVACY_CONTACT` | the address `/privacy` gives for a data request                                           | yes                                              |
| R2 variables                  | uploads, see below                                                                        | no                                               |

**Not one of the Supabase variables is `NEXT_PUBLIC_`, and that is checked
rather than assumed.** `readSiteConfig`, `readAuthConfig` and
`readServiceConfig` all read from a record passed in, so nothing in this
repository writes `process.env.SUPABASE_*` in a form a bundler could inline, and
`src/lib/supabase/service.ts` imports `server-only`, which fails the build if it
is ever pulled into a client component. Sign-in happens in a server action, so
the anon key never needs to reach a browser either.

`NEXT_PUBLIC_DATA_REGION` wants a country or a plain-English place, not a
provider region code. It is printed to guests inside an English sentence.

## The Supabase project's own settings

Two of them are not schema, are not in a migration, and will silently ruin the
paid activation path if they are wrong.

- **Site URL** must be the deployment's origin. A new project defaults to
  `http://localhost:3000`, which mails every buyer a magic link to their own
  laptop.
- **Redirect URLs** must admit `<origin>/**`. GoTrue compares a redirect
  against Site URL for _equality_ and against this list _by pattern_, and the
  claim flow returns to `/auth/callback?next=/claim/<code>`. Without a pattern
  that admits a path and a query string, GoTrue falls back to Site URL and drops
  the `next`, so the buyer arrives signed in, at an empty dashboard, having
  paid. `supabase/config.toml` says the same thing about the local stack and is
  where the reasoning is written out.

Both are settable from the Management API, so neither has to be a dashboard
click nobody can review.

### The magic link email template is the third one, and it is the dangerous one

Supabase's default template links to `{{ .ConfirmationURL }}`. That sends the
buyer through the auth service's own `/verify` endpoint, which verifies the
token and then hands the session back **in the URL fragment**:

    https://<site>/auth/callback?next=/claim/<code>#access_token=...

A fragment is never sent to a server. `src/app/auth/callback/route.ts` reads
`token_hash` from the query string, finds nothing, and answers
`/login?problem=link`. The buyer is told their link did not work, one tap after
paying, and the claim they paid for is dropped. Everything upstream of this
looks perfect while it happens.

`supabase/templates/magic-link.html` is the template that works: it links at
the app directly and appends the one-use token to `{{ .RedirectTo }}`, which is
already carrying the `?next=` for the claim in progress. `supabase/config.toml`
points the local stack at it. **A hosted project needs the same content in its
own auth settings**, and no migration carries it there.

`src/lib/auth/destination.ts` always emits a query string on the callback URL
for this reason, because a Go template cannot ask whether the URL it was handed
already has one. That coupling is asserted in
`tests/unit/auth/destination.test.ts` rather than left as a comment.

**On a free tier project using the built-in email sender, this template cannot
be changed** — the Management API refuses with "Email template modification is
not available for free tier projects using the default email provider". So a
free tier project with the built-in sender cannot complete a sign-in against
this app at all. That is not the constraint it first looks like: the built-in
sender is rate limited to two emails an hour and Supabase documents it as being
for development, so it was never going to deliver to real buyers. Configuring
the custom SMTP provider `AGENTS.md` already calls for is what unlocks both the
template and delivery, and it is the same step either way. Resend was chosen
over Postmark; the checklist is above.

### Sending email: the checklist

Resend, chosen over Postmark because the free tier covers this and it is the
lighter setup for one person. Nothing below can be done from this repository:
the account and the DNS records are the domain owner's, and the values marked
_generated_ only exist once the domain is added in Resend.

Do them in this order. Steps 3 and 4 fail in confusing ways if step 2 has not
verified yet.

**1. Create the Resend account and add the sending domain.** Use a subdomain,
`send.mirthly.app`, rather than the root. Sending reputation attaches to the
domain that sends, and keeping it off the root means a bad month for email
cannot follow the invitation links guests are opening.

**2. Add the records Resend shows, at the registrar.** Resend generates the
DKIM key and names the bounce host for the region chosen, so copy them from its
screen rather than from here. The shape is:

| Type  | Name                | Value                                                |
| ----- | ------------------- | ---------------------------------------------------- |
| `MX`  | `send`              | _generated_ (Resend's bounce host, priority 10)      |
| `TXT` | `send`              | `v=spf1 include:amazonses.com ~all`                  |
| `TXT` | `resend._domainkey` | _generated_ (the DKIM public key)                    |
| `TXT` | `_dmarc`            | `v=DMARC1; p=none; rua=mailto:<an address you read>` |

`p=none` on purpose to start: it asks for reports without telling anybody to
reject mail, which is what a domain with no sending history wants. Tighten it
after the reports come back clean.

Wait for Resend to report the domain verified. It is usually minutes.

**3. Point the project's auth settings at Resend**, under custom SMTP:

| Field        | Value                                       |
| ------------ | ------------------------------------------- |
| Host         | `smtp.resend.com`                           |
| Port         | `587`                                       |
| Username     | `resend` (the literal word, not an address) |
| Password     | the Resend API key                          |
| Sender email | an address at the verified sending domain   |
| Sender name  | what a buyer should see in their inbox      |

The API key is a secret and belongs only in that settings page. It does not go
in this repository, in Vercel, or in a commit.

**4. Install the magic link template.** Custom SMTP is what makes this possible
at all: a project on the built-in sender is refused with "Email template
modification is not available for free tier projects using the default email
provider". The content is `supabase/templates/magic-link.html`, verbatim, into
the project's magic link template.

**5. Raise the send rate limit.** The built-in sender caps it at two an hour,
and that cap does not lift on its own when SMTP changes. A single buyer asking
for a second link because they lost the first would otherwise be rate limited.

**6. Verify with a real mailbox, not a minted token.** Ask for a sign-in link
through `/login`, open it from the mail, and confirm it lands signed in. Then do
it again from a claim link and confirm it lands on the invitation rather than
the dashboard. A minted `token_hash` link proves the app and says nothing about
the template; only a link out of a mailbox proves both.

## Migrations reach a hosted project the same way they reach a local one

`supabase link --project-ref <ref>` then `supabase db push`. Check first with
`supabase migration list --linked`, which prints local against remote and is the
only honest answer to "is the schema applied".

It is worth actually running that. A deployment whose database is behind the
code does not fail at deploy time and does not fail loudly at request time
either: PostgREST answers 400 for a relationship that does not exist yet, the
guest read path turns any failure into a designed notice, and the site serves
"this page could not be loaded" for every slug with no indication anywhere of
why. That is what a first deployment here actually did, for six missing
migrations.

`src/lib/supabase/events.ts` now writes the reason to the server log, so the
same afternoon is not spent twice.

## Uploads need an object store, and a deployment with none refuses to pretend

With no R2 variables set, `selectStore` falls through to the filesystem driver,
whose root is a relative path. That is right locally and in CI, where it is a
real store on a real disk and the browser suite exercises the whole capability
through it. In a serverless function it is a read-only bundle that does not
outlive the request.

`assertStoreIsUsable` refuses that combination when `VERCEL` is set, naming the
four variables to set. `VERCEL` rather than `NODE_ENV`, because CI builds the
production output and runs the browser suite against it on a normal disk: what
makes a disk unusable is being a function's, not being in production.

An explicit `UPLOADS_DRIVER` or `UPLOADS_LOCAL_ROOT` is taken at its word.

**Uploads being off is a decision, not an outage.** The captain deferred
provisioning R2 to the day the Etsy listing publishes, alongside the Vercel Pro
upgrade that is deferred to the same day, because nothing is for sale yet and
the storage account needs a payment method on file. So a deployment refusing an
upload with the sentence above is this environment working as intended, and the
fix is the four R2 variables rather than anything in this repository. Everything
that is not an upload works: buyer photos, the music file and envelope artwork
are the only surfaces affected, and they are one capability with three uses,
which is why turning them off is one decision rather than three.

## Verifying a deployment, rather than assuming it

Against the deployment, not against localhost:

- `node scripts/check-anon-access.mjs` with the hosted credentials in the
  environment. It seeds through the service role first, so every "cannot read"
  assertion is made against a row that genuinely exists.
- `node scripts/seed-event.ts --state <one of the four>` four times, then open
  each slug. The four serving states are the thing most likely to be wrong and
  the thing least likely to be noticed.
- Read `og:url` and `og:image` off the live page and fetch the image. The share
  card is how an invitation spreads, and it is built from
  `NEXT_PUBLIC_SITE_URL`, so a wrong origin shows up here first.
- Follow a claim link the whole way. `tests/support/auth.ts` shows how to mint
  the `token_hash` link a correct email template would send, which exercises the
  real callback and the real allow list while skipping only the delivery. Do
  both: the minted link proves the app, and a link out of a real mailbox proves
  the template. They fail independently, and the template failing is the one
  that costs a sale.

`tests/e2e/caching.spec.ts` refuses to run against a dev server on purpose: a
cache header is a property of a deployment, so it is re-checked by hand on every
new host.
