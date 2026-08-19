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

**Three token pairings are also refused.** `findContrastViolations` in the same
file fails a block that draws ink on an accent fill, paints an ink fill at all,
or takes a boundary from `surface` or `border`. Those are the three pairings the
design directions report found failing in every direction, and
`tests/e2e/themes.spec.ts` is the backstop that catches a colour inherited across
two elements, which a source reader cannot see. `docs/design-directions.md` has
the numbers.

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

Which font each type role uses is no longer a block set decision. It was, and
the mapping in `src/app/globals.css` applied to every theme at once: `display`
and `title` took `font.heading`, `body` and `caption` took `font.body`. Masthead
cannot live with that, because Bodoni Moda is display only in that direction and
its section headings are 24px on a phone. So theme version 2 put the choice in
the token, as `typeScale.<role>.font`, and the utilities in `globals.css` now
read `--text-<role>-family` and decide nothing. See `docs/design-directions.md`.

### Why `border` is unused

Measured from the committed themes: `border` sits at 1.29:1 against `bg` in
ivory and 1.43:1 in midnight, and in each of the three design directions it is
the same value as `surface`, which is about 1.1:1. All of that is below the 3.0:1
a non-text boundary needs. A form control outlined in it would be invisible to a
lot of people, so controls use `inkMuted`, which clears 3.0:1 in every committed
theme. The role stays in the schema for decorative rules, where sub-3:1 is the
point, and `findContrastViolations` in `tests/unit/components/token-guard.ts`
fails a block that draws a boundary from it.

The design directions report reached the same conclusion from the other end:
`surface` is about 1.1:1 against `bg` in all three directions, on purpose,
because a stationery card is separated by paper edge and margin rather than by a
colour step. So a card is not a boundary either.

### The contrast pair the placeholder themes did not clear

`ivory` used to measure **3.82:1** for `accent` on `bg` and **3.95:1** for
`accentInk` on `accent`, both below the 4.5:1 AA needs, and the block set draws
the directions link and the RSVP button label on exactly those pairs. It was
recorded here as a theme value to fix.

It is fixed: ivory's accent is now `#856539`, which is the same brass at a darker
value, and it measures 5.19:1 and 5.36:1. What forced it was
`tests/unit/template/contrast.test.ts`, which measures every text pair the block
set can produce in every committed theme rather than only in the three design
directions. A suite that had to special case a known broken theme would be a
suite nobody trusted.

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
  to the token schema, which stores one size per role, and it is not made. What
  is made is the other half of the same finding: the names lockup stacks, name,
  ampersand, name, on three block level lines, because "Alexandra & Christopher"
  set on one line overflows 320px in all three directions. `break-words` stays
  for the case stacking cannot help with, which is one name long enough to
  overflow by itself. Overflow is a correctness failure on a phone; a wrapped
  line is not.
- **No map embed.** A tile embed needs a provider, an API key and third party
  JavaScript on a page a guest opens on bad wifi, and a key is deployment config
  rather than template content. The block links out to a maps app instead.
  `map.coordinates` is stored and not rendered for the same reason: it is
  waiting on a provider decision.
- **No web fonts of its own.** The theme carries a font stack, not a font file.
  The six faces the three design directions need are self hosted in
  `src/app/fonts.ts` through `next/font/google`, and the route swaps the head of
  each stack for the hosted face before handing tokens to `ThemeScope`. None of
  them is preloaded, so a browser fetches a font file only when it has a glyph to
  draw in it. `ivory` and `midnight` are not part of the template line and load
  nothing, so they still fall back to Georgia and system-ui.
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
serve. `?fixture=long-names` applies content overrides keyed by block id,
`?fixture=report-sample` is Emma & Jake at The Grounds of Alexandria, which is
the content the three design directions were measured against, and
`?rsvp=closed` shows the grace period state. `/preview` lists every theme with
links to all three fixtures.

It is not the guest page. There is no database read, no slug, and no designed
404, expired or unpublished state. Those are Phase 0.5, and this route becomes a
thin wrapper or goes away when they land. It is `noindex`, because placeholder
content under a real domain is not something a search engine should hold a copy
of.
