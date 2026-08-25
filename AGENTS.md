# Project agent memory

This file is the committed home for project-intrinsic agent knowledge. **It is loaded into every session and has a hard character limit — prefer rewriting or pruning entries over appending, and move long rationale into `docs/` with a pointer left here.** (The sibling project learned this the expensive way at 347k chars.)

## What this is

An **interactive invitation website platform**. A buyer purchases an invitation template on Etsy, redeems a code, fills in a guided form, and gets a personal event page at `/e/<slug>` that they share into WhatsApp and iMessage. Guests open it on a phone and RSVP.

**v1 is not an app, it is a fulfilment pipe for listings the captain already sells.** Anything that does not move a buyer from *Etsy purchase → live site → RSVPs captured* is out of scope. That sentence is the captain's and it settles most scope arguments.

Stack: **Next.js App Router + TypeScript (strict) + Tailwind + Supabase (Postgres, RLS) + Zod**, deployed on Vercel. Email is **Resend** (chosen 2026-08-24 over Postmark; never raw SMTP) — deliverability from a new domain needs SPF/DKIM/DMARC and a warm-up, and it is not wired up yet: `docs/hosting.md` has the checklist and says why a magic link cannot sign anybody in until it is.

**This Next is not the one you remember.** Read the guide under `node_modules/next/dist/docs/` before writing Next code; `middleware.ts` is now `proxy.ts`, and route segment config is read by static analysis so it will not take an imported constant.

**Everything runs locally with no cloud credential.** `supabase start`, `.env.example` copied to `.env.local`, `node scripts/seed-event.ts`. Do not put a hosted project name or a database region anywhere in the repo: the region is chosen once and is effectively irreversible, and it is the captain's call.

**The product is Mirthly, at `mirthly.app`** (`data/decision-product-name.md`). The repository, the Vercel project and the Supabase project are all still *named* `invite-platform`; renaming them is a separate action nobody has asked for. **The name is declared once, in the root layout**, as a title default plus a `%s - Mirthly` template, so no route repeats it; a live guest page opts out with `title: { absolute }` because the tab over an invitation belongs to the buyer, and `tests/unit/branding/name.test.ts` fails on the working title reappearing anywhere in `src/`. **How it is deployed is in `docs/hosting.md`** and the deployment shape is pinned in `vercel.json` rather than in a dashboard, for the same reason schema lives in migrations. Three things there are worth knowing before touching a hosted environment: the hosted database can be behind `main` and nothing says so out loud, the Supabase project's own Site URL and redirect allow-list are not schema and will silently break a paid activation if wrong, and a deployment with no R2 variables has no object store at all.

## Phase 0 is what we are building — and only that

Exit criteria, in the captain's words: *seed a template JSON by hand, create an event row, visit its slug on a phone, see a fast beautiful page with a live countdown, submit an RSVP, and see it in the database — with tests covering that loop.*

**Not in Phase 0:** payments, seller accounts, marketplace, freemium, custom domains, photo sharing. Filling a template in is built (`docs/editing.md`), and so is composing it (`docs/composition.md`): sections move, come off and go back, and the buyer picks their colours. A catalogue of designs to add a section from is not built and is gated on `ip-product-plan-decision-art-sourcing-and-capacity`. Activation is built (`docs/activation.md`): a claim link mints the buyer's copy, and publish and unpublish work.
**Not in v1 either:** direct payments (Etsy is the checkout), a buyer-facing RSVP question builder. The question *storage* is extensible from stage 2 and the shipped set is hardcoded (`src/lib/rsvp/questions.ts`); the guided form turns those on and off and no authoring surface is built, because a question in a buyer's own words is a question somebody has to classify.

**The editor is the tarpit.** Guided form, not drag-and-drop. Buyers of $18–$49 products expect "fill in and done", not Canva. If a task starts growing an editor, stop and say so.

## Rules that are expensive to change later

These are the reason Phase 0 exists. Treat them as binding. How the schema
implements them, and the reasoning behind slugs, timezone storage, hosting
expiry and RSVP retention, is in `docs/data-model.md`.

- **Every table carries `owner_id` and has RLS from the first migration**, even though v1 is single-tenant. Retrofitting tenancy is the most painful migration in this kind of product.
- **Schema lives in migrations in this repo, managed by the Supabase CLI. Never edit schema in the dashboard.** A dashboard edit is a change nobody can review and no environment can reproduce.
- **Guest pages and reply writes go through the service role. A buyer's dashboard goes through their own token.** Never direct anonymous table access. The service client is `src/lib/supabase/service.ts`: `server-only`, strict about its own env, and the only reader of the service role key. The dashboard uses `src/lib/supabase/buyer.ts` so the check is RLS in the database rather than a `where` clause somebody can forget. `scripts/check-anon-access.mjs` proves both boundaries over HTTP and CI runs it.
- **The template definition is a versioned JSON file format** — a block list, a per-block config validated by Zod, and theme tokens. **The `version` field exists from day one** so evolving a block does not break events already live. This is the product's file format and the most important decision in Phase 0. It lives in `src/lib/template/`, seeds are in `templates/`, and `docs/template-format.md` explains how it changes over time. **Content is keyed by block `id`, schemas are selected by block `type`.** Keeping those apart is what makes a rename survivable.
- **Theme tokens are separate from content.** That separation is what later lets a buyer pick a palette and lets us restyle without touching structure.
- **The template line is three themes, not one: Deckle & Deboss, Masthead, Foil & Midnight.** Their separateness is the product, so do not harmonise, rename or add a fourth. Every value in `templates/themes/` for those three is quoted from `data/ip-design-directions/report.md` and is not to be adjusted by eye. `docs/design-directions.md` is the map from that report to this format, including what it needed that the format did not have.
- **Contrast is asserted, not described.** `tests/unit/template/contrast.test.ts` recomputes the WCAG table for every committed theme, and the pairings that fail in every direction are made unreachable by the theme schema, the block token guard and a browser walk in `tests/e2e/themes.spec.ts`. A colour rule that lives only in a document is a claim without a check.
- **The hero artwork slot is decoration, and the format keeps it that way.** A
  template names `hero.artwork`; the block draws it as a band above the names
  with `alt=""` and nothing on top of it, so no text has its contrast measured
  against a picture. There is deliberately no alt field: artwork must carry no
  words, or the couple's details appear twice, once as pixels and once as real
  text. Everything in `public/samples/unlicensed-placeholder/` is an unlicensed
  placeholder that must not ship. See `docs/blocks.md`.
- **The envelope a guest opens is drawn over the invitation, never in place of it.** A guest's
  first sight is a closed envelope; the whole page is already rendered under it
  and stays reachable if it never opens. It opens with a checkbox and a sibling
  selector, so no JavaScript, no `:has()`, and nothing `inert` or `aria-hidden`.
  It is not a block: it is `definition.envelope` beside the block list, drawn
  from theme tokens, with `content.envelope` for the buyer's changes. A buyer's
  own envelope is the `envelope` upload kind and no second path: the content
  names `/a/<key>` for every stored width and never a hostname. See
  `docs/envelope.md`.
- **A block consumes tokens and nothing else. No hardcoded colour, font, radius or spacing value inside a block, ever.** One block set has to produce many visually distinct templates. If a theme variant looks broken, the fix goes into the **token schema** — never into a block component. Blocks live in `src/components/blocks/`, the envelope in `src/components/envelope/` obeys the same rule, a unit test fails the PR on a hardcoded value in either, and `docs/blocks.md` lists the roles they consume.
- **Guest pages are mobile-first and tested at 320px.** 90%+ of guests arrive from a chat link on a phone, often an old one on bad wifi.
- **OG/meta tags are a feature, not polish.** The share-card preview in WhatsApp is how an invitation spreads, and it is the first impression of the product.
- **404, expired and unpublished states are designed, never default error pages.** Guests hit them at emotional moments and it reflects on the buyer's shop reviews. Which state a request gets is `public.event_state_at` and nothing else: no code compares those timestamps a second time. `docs/serving.md` has the read path, the four states and the notices.
- **The guest page's cache lifetime is a privacy control before it is a speed one.** It bounds how long a guest can be shown "live, RSVPs open" for an event whose hosting has lapsed, which is new guest PII collected against a lapsed account. The numbers and the reasoning are in `src/lib/serving/cache.ts`, the header is set in `src/proxy.ts`, and `tests/e2e/caching.spec.ts` reads it off a real response and refuses to run against the dev server. A header is a property of a deployment, so it is re-checked by hand on every new host.
- **Countdowns are timezone-correct.** Event date after hosting expiry, and timezone boundaries, are known edge cases.
- **This repo is public. Never commit a secret.** No Supabase service-role key, no Resend or Postmark key, no activation-code secret, no database URL with a password. They live in GitHub and Vercel environment secrets, and only `NEXT_PUBLIC_` values ever belong in the repo.
- **RSVP data is guests' PII** — names, emails, dietary and health notes. The statement that says so ships at `/privacy` and `/terms`, and `tests/unit/legal/retention.test.ts` holds the days it prints to the days the sweep uses. Australian Privacy Act, GDPR if EU guests reply.
- **Uploads are one capability with three uses, never three features.** Buyer photos, the music file and envelope artwork share a table with a `kind` column, one ingest path, one object store, one retention schedule and one paragraph of terms. Limits live in the database (`public.upload_kind_cap`) because a route check can be raced; the TypeScript copy in `src/lib/uploads/kinds.ts` exists to word a refusal and a test holds the two together. `docs/uploads.md`.
- **An asset key is the sha256 of its own bytes, and that is what earns `immutable` for a year.** An edit produces a new address, so nothing is ever purged; two events that upload the same file share one object, so nothing is ever deleted without checking who else references it (`public.claim_upload_objects`). The app names only a platform-owned hostname and stores keys rather than URLs, so the storage vendor stays swappable by DNS; `src/lib/uploads/host.ts` refuses a vendor hostname outright. Removing bytes is the half Postgres cannot do: `platform.upload_objects` records the decision and `POST /api/uploads/sweep` carries it out.
- **The guided form is generated from the format, never written per block.** `src/lib/editor/fields.ts` turns a block's own Zod schema into a list of controls, so a sixth block type gets an editable form with nobody touching the editor; a unit test proves it against a block type that does not exist. A save writes only what differs from the template default, because content is overrides and an editor that wrote the merged config back would silently end that. It writes a new published revision through `public.save_event_content`, and refuses the whole document rather than half of it. `docs/editing.md`.
- **Activation has two links and conflating them is the expensive mistake.** `/t/<templateId>` renders a template, creates nothing and is meant to spread; `/claim/<code>` is single use and mints the buyer's own copy. An open copy link turns one sale into unlimited invitations, because here the invitation *is* the purchase. A code is a bearer token in a URL, the database is the only thing that hashes one, and a claim is idempotent because a second tap must open the invitation somebody already paid for and never a spent-code error. Claim links are built from `NEXT_PUBLIC_SITE_URL` and no host is hardcoded anywhere. `docs/activation.md`.
- **Before a save moves a fact a guest has already acted on, count the replies and ask.** The date, the time zone, the venue and the address, listed in `src/lib/editor/load-bearing.ts` because no schema can say that somebody has booked a flight around an answer. It is a confirmation and never a block, and nothing is sent to guests either way. Removing the section that carries one asks too: that is the same change expressed as a change to nothing.
- **Composition is an override, and removing a section never discards its words.** `content.sections` is a list of block ids; ABSENT means the template's own order, so a section added to a template still reaches every event that never composed, and a composition that returns to the template's order stops being stored. A removal takes an id out of the list and touches `content.blocks` not at all, because the stored document is the buyer's only copy of their own words. It rides in the content document so one press is one whole published revision and no guest reads half a reorder. `docs/composition.md`.
- **A buyer's palette may be refused by the form, never by the guest page.** `resolveEventPage` falls back to the template theme and reports it, and that path is what keeps an invitation on screen when a stored override cannot be read. The eight roles come from seven colour inputs plus a choice, because the token schema pins `accentInk` to `bg` or `surface`; contrast is recomputed beside the controls and reported, never enforced. `src/lib/editor/palette.ts`.
- **Production is published by CI, never by Vercel's git integration, and a publish is not finished until the live address says so.** The `deploy` job in `.github/workflows/ci.yml` runs after the gate on a merge to `main`, and its last step reads `NEXT_PUBLIC_SITE_URL/api/version` over plain HTTP until it serves that commit; `vercel.json` turns Vercel's own `main` deploys off so there is one publisher, and previews stay Vercel's. `.github/workflows/is-production-current.yml` asks the same question daily and opens an issue. This exists because on 2026-08-24 a push GitHub handed to the Vercel GitHub App produced no deployment, no commit status and no record, and nobody noticed for a day. **The credential is questioned before the publish, not diagnosed after it**: `.github/scripts/vercel-scope.mjs` asks Vercel whether the token is accepted, whether it reaches `VERCEL_ORG_ID` and whether `VERCEL_PROJECT_ID` resolves inside it, because `vercel pull` reports all three as one sentence about a `.vercel` directory that does not exist in CI. It never prints the token. `docs/hosting.md`.
- **A reply is an envelope plus answers, and `pii_class` is what makes the retention promise enforceable.** A question is a row and never template config, so no stored document can introduce personal information nobody classified; the sweep reads that column and never a prompt. An answer snapshots its question and is immutable, and a question can only be retired, never deleted. The schema enforces all of it. `docs/replies.md`.

## Testing

**Playwright smoke tests from day one, and CI runs typecheck, lint and tests on every PR.** The captain's background is test automation; this is the unfair advantage most solo builders skip and pay for later.

**Every bug ships with a regression test that fails first.** Write the failing test, confirm it fails for the stated reason, then fix. If something is genuinely untestable at a sensible layer, say so plainly in the PR with the reason — never skip it silently, and never write a test that asserts nothing.

**Assert the thing you care about, not its shadow.** The sibling project shipped a dead-end screen past nine passing tests because every assertion was "this element is absent", and shipped a real bug through 20 of 22 green CI runs because a test asserted a badge was *visible* without reading its value.

## Conventions

- No em dashes in code, comments, commit messages or PR bodies.
- No co-author trailer on commits.
- Commit and PR messages say what changed and why, in plain sentences.
- `tsconfig.json` is committed in the exact shape `next dev` writes it, and is in `.prettierignore` so the two formatters cannot take turns. Never reformat it; `tests/unit/toolchain/tsconfig-shape.test.ts` explains why and fails if it drifts.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
