# The five v1 blocks

Phase 0.4. `hero`, `details`, `countdown`, `map`, `rsvp-form`, and nothing else.
The components are in `src/components/blocks/`, the token bridge is
`src/components/theme-scope.tsx`, and the event time functions the countdown and
the details list share are in `src/lib/event/time.ts`.

Start at `docs/template-format.md` for the documents these render. This file is
about what a block is allowed to do.

## A block consumes tokens and nothing else

That is the rule the whole set is built around, and it is checkable rather than
aspirational. `tests/unit/components/block-tokens.test.ts` reads every file in
`src/components/blocks/` and fails the pull request on a hex colour, a CSS
length, an inline style, or any Tailwind class from a colour, font, radius or
spacing namespace that is not reading a `var(--token)`. The list of legal tokens
comes from `themeToCssVariables`, so removing a role from the schema breaks
every block still using it.

The guard is also shown a source written to break the rule and has to report
every break in it. A guard nobody has watched fail is not a guard.

**Layout is not policed.** `grid`, `w-full`, `col-start-2`, `min-h-dvh` and
`max-w-prose` are structure. The rule in AGENTS.md names four things: colour,
font, radius, spacing.

Two exceptions, both deliberate and both narrow:

- **Border width.** There is no border width token, so form controls use the
  browser hairline. A theme that needs a heavier rule needs a token, not a class
  in a block.
- **The reading measure.** `max-w-prose` sits on `ThemeScope`, not in a block,
  and is expressed in `ch`, so it scales with whatever body face the theme sets.

## The token roles the block set actually consumes

This is the list to check a chosen design direction against.

| Group  | Consumed                                                        | Not consumed |
| ------ | --------------------------------------------------------------- | ------------ |
| colour | `bg` `surface` `ink` `inkMuted` `accent` `accentInk` `critical` | `border`     |
| type   | `display` `title` `body` `caption`                              | none         |
| font   | `heading` `body`                                                | none         |
| space  | `xs` `sm` `md` `lg` `xl`                                        | none         |
| radius | `md` `lg` `pill`                                                | `sm`         |

Where each one lands:

- **bg** page canvas. **surface** the map card and every form control fill.
- **ink** body copy. **inkMuted** eyebrow, subhead, detail labels, address,
  notes, countdown unit labels, form labels, and every form control boundary.
- **accent** detail icons, the directions link, the RSVP button fill.
  **accentInk** the RSVP button label, which is the only text drawn on `accent`.
- **critical** the RSVP submission failure message, and nothing else.
- **display** the couple's names, once, in the hero. **title** section headings,
  the venue name, the countdown numbers and the passed message. **body**
  paragraphs, controls and links. **caption** labels and notes.
- **space.md** across every section, **space.xl** down, so the distance between
  two blocks is a theme decision rather than a block decision.

`display` is deliberately not used for the countdown numbers. Three digits of
`display` plus gaps does not fit four columns at 320px, and all three design
directions use display for the names or the date lockup rather than for a
counter.

Which font each type role uses is the one decision the token schema does not
make and the block set does: `display` and `title` take `font.heading`, `body`
and `caption` take `font.body`. That mapping is in `src/app/globals.css` and
holds for all three directions in `data/ip-design-directions/report.md`.

### Why `border` is unused

Measured from the committed themes: `border` sits at 1.29:1 against `bg` in
ivory and 1.43:1 in midnight, which is below the 3.0:1 a non-text boundary
needs. A form control outlined in it would be invisible to a lot of people, so
controls use `inkMuted`, which measures 5.20:1 at worst across both themes and
clears 3.0:1 comfortably in all three design directions. The role stays in the
schema for decorative rules, where sub-3:1 is the point.

The design directions report reached the same conclusion from the other end:
`surface` is about 1.1:1 against `bg` in all three directions, on purpose,
because a stationery card is separated by paper edge and margin rather than by a
colour step. So a card is not a boundary either.

### One contrast pair the placeholder themes do not clear

`ivory` measures **3.82:1** for `accent` on `bg` and **3.95:1** for `accentInk`
on `accent`. Both are below the 4.5:1 AA needs for normal text, and the block
set draws the RSVP button label and the directions link on exactly those pairs.
`midnight` clears both at 9.21:1.

This is a theme value to fix, never a block change, and it is not fixed here
because the direction has not been chosen. All three directions in the report
already clear it: 8.16:1, 8.70:1 and 8.73:1. Whichever one is picked, those two
pairs are the ones to check.

## Time

`events.starts_at_local` plus `events.time_zone` is the source of truth, and
`starts_at_utc` is a cache this code never reads. `resolveEventSchedule` turns
the pair into an instant on every render, so a government moving a DST boundary
between activation and the wedding changes the answer the next time a guest
opens the link.

The countdown counts between two instants, which is the same number of
milliseconds in every zone, so a guest in London sees the correct time remaining
for a wedding in Sydney and a countdown spanning a DST change stays honest. The
details list formats the wall clock as the buyer typed it, in one locale rather
than the guest's, because an invitation is a printed object and every guest
should read the same words.

Two edge cases are decided in `src/lib/event/time.ts` rather than left to
whichever browser the guest opened the link in, and both are tested: a local
time that does not exist resolves forward across the gap, and a local time that
happens twice resolves to the later of the two.

The clock in the browser is an external store, not state set in an effect, so
the first client render uses the server's `now` and hydrates exactly.

## What these blocks deliberately do not do

Each of these is a format or token question, not a block question, and each is
here so the next task does not rediscover it.

- **No fluid display size.** The design directions report recommends the display
  size scale itself down so a long name does not have to wrap. That is a change
  to the token schema, which stores one size per role. The hero instead wraps and
  breaks inside a word if it has to, and the 320px overflow test runs against
  "Alexandra & Christopher" rather than the sample couple. Overflow is a
  correctness failure on a phone; a wrapped line is not.
- **No map embed.** A tile embed needs a provider, an API key and third party
  JavaScript on a page a guest opens on bad wifi, and a key is deployment config
  rather than template content. The block links out to a maps app instead.
  `map.coordinates` is stored and not rendered for the same reason: it is
  waiting on a provider decision.
- **No web fonts.** The theme carries a font stack, not a font file, so ivory
  currently falls back to Georgia. Self hosting through `next/font` arrives with
  the chosen direction, since which faces to load is exactly what the direction
  decides.
- **No themed focus ring.** There is no focus token, so the browser's own focus
  ring is kept rather than a colour being invented for one. If a direction needs
  a designed focus state, that is a new role.
- **No hero image dimensions.** The hero image is a plain `img`. `next/image`
  needs either a host allowlist or stored dimensions and the format has neither:
  an image src is any https URL and there is nowhere to put a width and a height.
  Both arrive with buyer uploads, and until then a hero image can shift layout as
  it loads.
- **No copy for the fields the format does not carry.** The RSVP name and
  attendance labels, the countdown unit names and the "Get directions" label are
  block set copy, because `fields` is a record of four optional questions and the
  countdown stores unit keys rather than labels. Rewording any of them is a
  config field and a version migration, not an edit in a component.

## The preview route

`/preview/<theme>` renders the committed seed documents through the real
`resolveEventPage`, so what is on screen is the same merge a guest page will
serve. `?fixture=long-names` applies content overrides keyed by block id, and
`?rsvp=closed` shows the grace period state.

It is not the guest page. There is no database read, no slug, and no designed
404, expired or unpublished state. Those are Phase 0.5, and this route becomes a
thin wrapper or goes away when they land. It is `noindex`, because placeholder
content under a real domain is not something a search engine should hold a copy
of.
