# invite-platform

Interactive invitation websites. See `AGENTS.md` for the product contract and the
constraints that are binding on every change.

This repo carries the application shell and CI gate, the data model, the
template definition format, the Open Graph share card, and the guest page: a
slug at `/e/<slug>` resolves to an event, a template and a published revision,
and renders through the blocks and themes. There is no auth, no editor and no
reply path yet. Those are separate tasks.

`docs/serving.md` is the place to start on the guest page: the four serving
states, the read path, and why the page's cache lifetime is a privacy control
before it is a speed one.

The template format is the product's file format: three versioned JSON documents,
five block types, and theme tokens kept out of content. It lives in
`src/lib/template/`, its seed files are in `templates/`, and
`docs/template-format.md` explains the shape and how it changes over time.
Nothing in it renders anything.

The share card is the 1200x630 image chat apps show when a link is pasted,
generated per event from theme tokens plus the event's fields, and designed
against the 120px thumbnail it is first seen at rather than against full size.
It lives in `src/lib/og/`, is served from `/api/og?slug=<slug>&v=<digest>`, and
`docs/og-card.md` explains the constraint. It takes a slug and resolves every
field from the event row: nothing a caller sends can reach the card.

## Requirements

Node 24. The exact version CI runs is pinned in `.github/workflows/ci.yml`.

The Supabase CLI and a container runtime, for the database. Everything in this
repo runs against the CLI's local stack, and nothing needs a hosted account:

```bash
supabase start        # applies every migration to a fresh database
cp .env.example .env.local
supabase status       # paste the API URL and service role key into .env.local
node scripts/seed-event.ts --title "Emma & Jake" --starts 2027-03-14T16:00:00
npm run dev           # open /e/<the slug it printed>
```

## Commands

| Command                              | What it does                                    |
| ------------------------------------ | ----------------------------------------------- |
| `npm run dev`                        | Dev server on http://localhost:3000             |
| `npm run build`                      | Production build                                |
| `npm start`                          | Serve the production build                      |
| `npm run typecheck`                  | Generate Next route types, then `tsc --noEmit`  |
| `npm run lint`                       | ESLint                                          |
| `npm run format`                     | Prettier check (`npm run format:write` to fix)  |
| `npm test`                           | Vitest unit tests                               |
| `npm run test:e2e`                   | Playwright smoke tests                          |
| `supabase test db`                   | pgTAP suite over the schema and its policies    |
| `node scripts/check-anon-access.mjs` | Proves an anonymous client is denied, over HTTP |
| `node scripts/seed-event.ts`         | Creates an event without a dashboard            |

`npm run test:e2e` starts its own server: the dev server locally, and the production
build when `CI` is set. Run `npx playwright install chromium` once before the first
e2e run. It also needs a local stack up, because the guest page specs seed real
events and walk all four serving states. The cache header spec refuses to run
against the dev server on purpose: run it as `CI=1 npm run test:e2e` after a
build, or point `DEPLOYED_BASE_URL` and `DEPLOYED_EVENT_SLUG` at a deployment.

## Configuration

A build needs no variables at all, and CI proves that by building without any.
`src/lib/env.ts` reads optional config and falls back rather than throwing.
Strict checks belong to the module that needs the value: reaching the database
without one throws on the first read, naming every missing variable at once,
rather than failing a build that never needed it.

`.env.example` is the list. Copy it to `.env.local`, which is git ignored, and
fill it from `supabase status`.

| Variable                    | Required for              | Absent behaviour               |
| --------------------------- | ------------------------- | ------------------------------ |
| `NEXT_PUBLIC_SITE_URL`      | canonical and OG URLs     | falls back to `localhost:3000` |
| `SUPABASE_URL`              | any page that reads a row | throws on the first read       |
| `SUPABASE_SERVICE_ROLE_KEY` | same                      | same                           |

The service role key is read only by `src/lib/supabase/service.ts`, which is
marked `server-only`, so a client component importing it fails the build rather
than shipping the key to a browser. It must never appear in a `NEXT_PUBLIC_`
variable or in this repo.

## CI

`static` (typecheck, lint, format, unit tests) runs on every pull request and
also decides whether Playwright is needed. `playwright smoke` runs only when a
changed file could affect what it exercises, and always on pushes to main.
`migrations, policies and RLS` starts the Supabase CLI's stack, applies every
migration to an empty database, runs the pgTAP suite and proves an anonymous
client is still denied over HTTP; it is unfiltered, because the case that
matters most is application code that starts reading a table it should not
reach. `CI gate` is the single required status check.

Set branch protection to require **`CI gate`**, not the individual jobs.
Requiring `playwright smoke` directly would block every pull request where it is
legitimately skipped. The gate reads the whole `needs` context and requires every
job in it to have succeeded, with the single exception of a job explicitly
declared conditional, which is checked against the decision made about it. A job
that was skipped when it should have run makes it red. Its logic lives in
`.github/scripts/ci-gate.sh` and is covered by `.github/scripts/ci-gate.test.sh`,
which the `static` job runs.

Every job reports its wall clock duration and the gate prints a cost table with
billed minutes. GitHub rounds each job up to a whole minute, so the billed column
is what a private repo is actually charged, and job count is a direct cost.

### Adding to CI

`.github/workflows/ci.yml` is owned by one task at a time. If your work needs CI
to do something new, such as a Postgres service container for migrations and RLS
policy tests, send the requirement rather than editing the workflow. There is a
worked example of how a database job slots in at the bottom of that file.

Adding a job to the gate's `needs` is all that is required to make it enforced.
The gate requires unlisted jobs to succeed by default, so forgetting to teach it
about a new job makes the check stricter, never weaker.
