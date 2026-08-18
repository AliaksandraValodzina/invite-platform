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

`static` (typecheck, lint, format, unit tests) runs on every pull request.
`playwright smoke` runs only when a changed file could affect what it exercises,
and always on pushes to main. `CI gate` is the single required status check.
The reasoning is in the comments at the top of the workflow.
