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
- Follow a claim link the whole way, including the trip through a mailbox.
  Verifying that the page loads verifies nothing about the redirect allow-list.

`tests/e2e/caching.spec.ts` refuses to run against a dev server on purpose: a
cache header is a property of a deployment, so it is re-checked by hand on every
new host.
