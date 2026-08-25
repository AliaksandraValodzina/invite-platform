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

## Publishing is done by CI, and why

**A merge to `main` is published by the `deploy` job in
`.github/workflows/ci.yml`, after the gate. Vercel's own deployments from
`main` are off, in `vercel.json`.** Previews are still Vercel's.

### What happened

On 2026-08-24 the merge of #17 produced no Vercel deployment at all. Not a
failed one, not a cancelled one: none. The site went on serving the previous
commit for a day, and what noticed was a person reading the page.

The evidence, all of it public and all of it re-checkable:

| Fact                                                                                   | Where                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------- |
| GitHub Actions ran on the merge commit at `10:21:00Z`                                  | `actions/runs`, event `push`, head `6ea846d` |
| GitHub opened a check suite for the **vercel** app at `10:20:59Z`                      | `commits/6ea846d/check-suites`               |
| That check suite is still `queued`, `conclusion: null`                                 | same                                         |
| The commit has **no** `Vercel` status. Every earlier push to `main` has one, `success` | `commits/<sha>/status`, six commits compared |
| Vercel has no deployment for that commit                                               | `v6/deployments?projectId=...`               |

So the push reached GitHub, GitHub dispatched it to the Vercel GitHub App, and
nothing came back. The failure is on the far side of a delivery this account
cannot inspect: a third-party GitHub App's delivery log is visible only to the
app's owner.

Everything that could have suppressed it deliberately was checked and is
correct: the app still has access to this repository
(`v1/integrations/search-repo` lists it), the project's `productionBranch` is
`main`, `gitProviderOptions.createDeployments` is `enabled`, the team is
`blocked: null`, `softBlock: null`, `featureBlocks: {}` with billing `active`,
there is no branch protection and no `[skip ci]` token in the commit message.

One correction to the story as it was first told: **#14, #15 and #16 did reach
production.** Each has a `Vercel` status of `success` and a matching production
deployment. What made the site look four changes behind is that the scaffolding
heading and the `Invite Platform` tab title were still there at `79df4d5`, and
#17 is what deleted them. One merge was lost, not four. It looked like four.

### Why the answer is not "reconnect it"

There was nothing to reconnect. A cause that leaves no record, has no retry and
no alarm cannot be declared fixed, and the next occurrence would look exactly
like this one: green everywhere, stale in public. The Hobby plan is worth
naming for a different reason. It is non-commercial and the product is heading
for a paid Etsy listing, so the account will change; but nothing in this
incident points at a plan limit, and no plan change was made.

So publishing moved to the place where a failure is visible: a job on `main`,
in a repository that is public, so Actions minutes are free.

### What the job does, and the one step that matters

`vercel pull`, `vercel build --prod`, `vercel deploy --prebuilt --prod`, and
then the step the whole job exists for:

```
node .github/scripts/deployed-commit.mjs "<origin>" "$GITHUB_SHA"
```

It reads `<origin>/api/version` over plain HTTP with no credential, the same
wire a guest uses, and stays red until the address serves the commit that was
merged. A publish is not finished when the CLI prints a URL. It is finished when
the address a buyer typed has the work.

`<origin>` is `NEXT_PUBLIC_SITE_URL`, read out of the production environment the
job just pulled, because that is the value the app builds its own links from.
No host name is written into the workflow, for the same reason none is written
anywhere else in this repository.

`/api/version` reports the commit and nothing else. It is separate from
`/api/health`, whose contract is process liveness for Playwright's webServer and
must stay that. The commit reaches it as `NEXT_PUBLIC_BUILD_COMMIT`, stamped by
the job into `.vercel/.env.production.local` before the build, because Vercel
does not carry a build-time variable into a function's runtime environment and
`NEXT_PUBLIC_` is the prefix Next inlines. A commit hash of a public repository
is not a secret. `VERCEL_GIT_COMMIT_SHA` is the fallback, so a deployment made
from the dashboard still answers, and `source` says which one did.
`src/lib/build-info.ts` has the rest.

### When the credential is wrong, the job says which way

`vercel pull` is the job's first real command and it has one failure message for
three different problems:

```
Error: Could not retrieve Project Settings.
To link your Project, remove the `.vercel` directory and deploy again.
```

In CI that advice cannot apply: `.vercel` is gitignored, so there is no
directory to remove. Reading the pinned CLI's own source says where the sentence
comes from. It resolves the project link from `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID`, looks the owner and the project up, and prints exactly that
when either lookup answers `403` with code `forbidden` or `team_unauthorized`. A
`404` prints something else and an unusable token throws something else again.
So it is a permission answer dressed as a linking answer, and it never says
which permission.

`.github/scripts/vercel-scope.mjs` runs before the pull and asks the three
questions separately, each only when the one before it said yes:

| Question                                      | Asked with                                    | If no                                                                      |
| --------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| Is this token a credential the CLI can use?   | `vercel whoami`                               | `token-not-accepted`: refused outright, or accepted with no user behind it |
| Can it resolve `VERCEL_ORG_ID` as a scope?    | `vercel project list --scope <org> --limit 1` | `scope-not-reachable`: the token belongs to a different scope              |
| Does `VERCEL_PROJECT_ID` exist in that scope? | `vercel project inspect <project> --scope`    | `project-not-in-scope`: wrong id, deleted, or transferred                  |

All three yes is reported as "not the cause" rather than as "fine", and the pull
runs and speaks for itself.

The token never reaches a command line. It is handed to the CLI through the
child process environment, which the CLI reads as `VERCEL_TOKEN`, and every
captured line is passed through a redactor on the way to the log in case the CLI
ever echoes it back. What is reported about the token itself is its length and
whether it has surrounding whitespace, because a secret pasted with a trailing
newline is a real failure and otherwise an invisible one. Neither is a fragment
of the value.

### What this found, on 2026-08-25

`token-not-accepted`. `vercel whoami` did not get a refusal; it got an answer,
and the answer was `Error: User not found.` Vercel accepted the request made
with the value in `VERCEL_TOKEN` and said there is no user behind it. That is
why the pull's owner and project lookups came back `403` and why the generic
sentence appeared: it was reporting the last consequence of a credential that
does not identify anybody, in the vocabulary of the first thing it happened to
try.

So the fix is the captain's and it is one thing: create a personal access token
at <https://vercel.com/account/settings/tokens>, under the scope that owns the
project, and replace the `VERCEL_TOKEN` repository secret with it. The value in
the secret now is 60 characters with no surrounding whitespace, which is not the
shape of one.

`publish-credential` runs the same script on a pull request that changes the
publisher, because `deploy` runs only on a push to `main` and so every change to
it is otherwise merged untried. It only reads and it publishes nothing. It is
deliberately outside the gate's `needs`: it answers a question about the
repository's secrets rather than about the diff, and a wrong secret must not
block a merge that has nothing to do with it.

### And a check that does not depend on anybody merging

`.github/workflows/is-production-current.yml` asks the same question once a day
and opens an issue when the answer is no. The deploy job covers the way this
went wrong; the daily run covers the ways it has not gone wrong yet and would be
just as quiet: a rollback nobody undid, an alias moved by hand, a deploy job
removed or skipped. It says nothing when `main` is less than twenty minutes old,
because a publish may still be running and a monitor that cries wolf gets
switched off.

Worst case exposure is now the length of a CI run for a merge, and a day for
everything else.

### What only the captain can do

In this order. **Steps 1 and 2 before this is merged**, because after it
`vercel.json` stops Vercel publishing `main` and the job is the only publisher.

1. Create a Vercel access token. <https://vercel.com/account/settings/tokens> →
   **Create Token**. Name it `github-actions-invite-platform`. Scope it to the
   team **Sasha's projects**. Expiry: pick one and put the date in the calendar,
   because an expired token fails this job loudly rather than silently, which is
   the right failure but still a failure. Copy the value; it is shown once.
2. Add it to the repository.
   <https://github.com/AliaksandraValodzina/invite-platform/settings/secrets/actions>
   → **New repository secret** → name `VERCEL_TOKEN`, value from step 1.
   (`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are already set as repository
   variables. They are identifiers, not credentials, and grant nothing without
   the token. Move them to secrets if you would rather.)
3. Merge this pull request. Watch the `publish to production` job. Its last step
   should print `mirthly.app is serving <the merge sha>`.
4. Confirm by hand once, because this is the first run:
   `curl https://mirthly.app/api/version` should report that same commit with
   `"source":"ci"`.
5. Nothing needs turning off in the Vercel dashboard. `vercel.json` already
   tells Vercel not to deploy `main`, and it is in the repository where it can
   be reviewed, which is the same rule this project applies to schema. If you
   would rather see it in the dashboard too: Project → Settings → Git →
   **Ignored Build Step** is _not_ the place; the branch setting is
   `Production Branch`, and it should be left as `main` so previews and manual
   redeploys keep working.
6. When the Etsy listing goes live and the account moves off Hobby, re-read this
   section. Nothing here depends on the plan, but the token does not survive an
   account transfer.

## Verifying a deployment, rather than assuming it

Against the deployment, not against localhost:

- `curl <origin>/api/version` and read the commit back. It is the cheapest
  question and the one that was not being asked: everything below tests
  behaviour, and this tests whether the behaviour being tested is the current
  code at all. `.github/workflows/ci.yml` asks it on every merge.
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
