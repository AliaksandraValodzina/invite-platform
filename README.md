# invite-platform

Interactive invitation websites. See `AGENTS.md` for the product contract and the
constraints that are binding on every change.

This repo is currently at Phase 0.1: the application shell and the CI gate. There is
no Supabase client, no schema, no template format and no auth yet. Those are separate
tasks.

## Requirements

Node 24. The exact version CI runs is pinned in `.github/workflows/ci.yml`.

## Commands

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Dev server on http://localhost:3000            |
| `npm run build`     | Production build                               |
| `npm start`         | Serve the production build                     |
| `npm run typecheck` | Generate Next route types, then `tsc --noEmit` |
| `npm run lint`      | ESLint                                         |
| `npm run format`    | Prettier check (`npm run format:write` to fix) |
| `npm test`          | Vitest unit tests                              |
| `npm run test:e2e`  | Playwright smoke tests                         |

`npm run test:e2e` starts its own server: the dev server locally, and the production
build when `CI` is set. Run `npx playwright install chromium` once before the first
e2e run.

## Configuration

Nothing in this repo requires an environment variable to be set. `src/lib/env.ts`
reads optional config and falls back rather than throwing, so a build with no
variables present is expected to succeed. When a real service is added, its own
module owns its strict checks.

| Variable               | Required | Absent behaviour               |
| ---------------------- | -------- | ------------------------------ |
| `NEXT_PUBLIC_SITE_URL` | No       | Falls back to `localhost:3000` |

## CI

`static` (typecheck, lint, format, unit tests) runs on every pull request and
also decides whether Playwright is needed. `playwright smoke` runs only when a
changed file could affect what it exercises, and always on pushes to main.
`CI gate` is the single required status check.

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
