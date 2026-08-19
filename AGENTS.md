# Project agent memory

This file is the committed home for project-intrinsic agent knowledge. **It is loaded into every session and has a hard character limit — prefer rewriting or pruning entries over appending, and move long rationale into `docs/` with a pointer left here.** (The sibling project learned this the expensive way at 347k chars.)

## What this is

An **interactive invitation website platform**. A buyer purchases an invitation template on Etsy, redeems a code, fills in a guided form, and gets a personal event page at `/e/<slug>` that they share into WhatsApp and iMessage. Guests open it on a phone and RSVP.

**v1 is not an app, it is a fulfilment pipe for listings the captain already sells.** Anything that does not move a buyer from *Etsy purchase → live site → RSVPs captured* is out of scope. That sentence is the captain's and it settles most scope arguments.

Stack: **Next.js App Router + TypeScript (strict) + Tailwind + Supabase (Postgres, RLS) + Zod**, deployed on Vercel. Email via **Resend or Postmark, never raw SMTP** — deliverability from a new domain needs SPF/DKIM/DMARC and a warm-up.

## Phase 0 is what we are building — and only that

Exit criteria, in the captain's words: *seed a template JSON by hand, create an event row, visit its slug on a phone, see a fast beautiful page with a live countdown, submit an RSVP, and see it in the database — with tests covering that loop.*

**Not in Phase 0:** any editor, payments, auth UI beyond basic login, seller accounts, marketplace, freemium, custom domains, photo sharing.
**Not in v1 either:** direct payments (Etsy is the checkout), custom RSVP question builder (hardcode attending / guest count / dietary / message).

**The editor is the tarpit.** Guided form, not drag-and-drop. Buyers of $18–$49 products expect "fill in and done", not Canva. If a task starts growing an editor, stop and say so.

## Rules that are expensive to change later

These are the reason Phase 0 exists. Treat them as binding. How the schema
implements them, and the reasoning behind slugs, timezone storage, hosting
expiry and RSVP retention, is in `docs/data-model.md`.

- **Every table carries `owner_id` and has RLS from the first migration**, even though v1 is single-tenant. Retrofitting tenancy is the most painful migration in this kind of product.
- **Schema lives in migrations in this repo, managed by the Supabase CLI. Never edit schema in the dashboard.** A dashboard edit is a change nobody can review and no environment can reproduce.
- **Guest pages and RSVP inserts are served through API routes with the service role.** Never direct anonymous table access.
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
- **A block consumes tokens and nothing else. No hardcoded colour, font, radius or spacing value inside a block, ever.** One block set has to produce many visually distinct templates. If a theme variant looks broken, the fix goes into the **token schema** — never into a block component. Blocks live in `src/components/blocks/`, a unit test fails the PR on a hardcoded value, and `docs/blocks.md` lists the roles they consume.
- **Guest pages are mobile-first and tested at 320px.** 90%+ of guests arrive from a chat link on a phone, often an old one on bad wifi.
- **OG/meta tags are a feature, not polish.** The share-card preview in WhatsApp is how an invitation spreads, and it is the first impression of the product.
- **404, expired and unpublished states are designed, never default error pages.** Guests hit them at emotional moments and it reflects on the buyer's shop reviews.
- **Countdowns are timezone-correct.** Event date after hosting expiry, and timezone boundaries, are known edge cases.
- **This repo is public. Never commit a secret.** No Supabase service-role key, no Resend or Postmark key, no activation-code secret, no database URL with a password. They live in GitHub and Vercel environment secrets, and only `NEXT_PUBLIC_` values ever belong in the repo.
- **RSVP data is guests' PII** — names, emails, dietary and health notes. That means a privacy policy, Australian Privacy Act awareness, GDPR if EU guests RSVP, and retention/deletion rules when events expire. Do not add a field to the RSVP form without saying what happens to it at expiry.

## Testing

**Playwright smoke tests from day one, and CI runs typecheck, lint and tests on every PR.** The captain's background is test automation; this is the unfair advantage most solo builders skip and pay for later.

**Every bug ships with a regression test that fails first.** Write the failing test, confirm it fails for the stated reason, then fix. If something is genuinely untestable at a sensible layer, say so plainly in the PR with the reason — never skip it silently, and never write a test that asserts nothing.

**Assert the thing you care about, not its shadow.** The sibling project shipped a dead-end screen past nine passing tests because every assertion was "this element is absent", and shipped a real bug through 20 of 22 green CI runs because a test asserted a badge was *visible* without reading its value.

## Conventions

- No em dashes in code, comments, commit messages or PR bodies.
- No co-author trailer on commits.
- Commit and PR messages say what changed and why, in plain sentences.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
