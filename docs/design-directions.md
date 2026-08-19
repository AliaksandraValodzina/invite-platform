# The three design directions

The first template line. Three themes, not one: the captain's decision of
2026-08-20 was to build all three directions from the scout report rather than
pick between them, because their separateness is the product. Nothing here
harmonises them, and there is no fourth.

The source is `data/ip-design-directions/report.md`, outside this repo. It is
where the palettes, the type pairings, the contrast table and the three measured
findings come from, and every value in `templates/themes/` is quoted from it.
This file is about how those values landed in the format the repo already had.

| Direction       | Theme file                                | Mood                                                     | Signature element          |
| --------------- | ----------------------------------------- | -------------------------------------------------------- | -------------------------- |
| Deckle & Deboss | `templates/themes/deckle-and-deboss.json` | Single ink letterpress on cotton stock, oxblood ink      | The pressed monogram       |
| Masthead        | `templates/themes/masthead.json`          | Modern editorial, didone masthead, ultramarine           | The full bleed date lockup |
| Foil & Midnight | `templates/themes/foil-and-midnight.json` | 1930s foil stamped evening invitation, brass on midnight | The stepped arch aperture  |

## How to look at them

```
npm run dev
open http://localhost:3000/preview
```

`/preview` lists all three with links. Each direction has three fixtures:

- `?fixture=report-sample` is Emma & Jake at The Grounds of Alexandria on 14
  March 2027, the content the directions were designed and measured against.
- `?fixture=long-names` is Alexandra & Christopher, which is the fixture the
  320px overflow test uses.
- `?fixture=sample` is the template's own default copy.

`/preview/<theme>` renders the committed seed documents through the real
`resolveEventPage`, so what is on screen is the merge a guest page will serve.
It is not the guest page: there is no database read, no event slug, no auth and
no designed 404 or expired state, because none of those exist yet.

## What the report asked for that the format already had

Colour roles, font stacks, a type scale, a space scale and a radius scale, all
as tokens in their own versioned document, separate from content. The three
directions are expressed in exactly that, with two conversions and one mapping,
all of them mechanical and all of them asserted in
`tests/unit/template/seed.test.ts`:

- **px to rem.** The report writes sizes in px and the schema stores rem, so
  every size is the report's number over 16. Exact, and the only arithmetic
  anything does to these values.
- **`h2` is `title`.** The report's type role for a section heading is this
  format's `title`.
- **Eight space steps to five.** The report gives an ordered eight step scale
  and the schema has `xs sm md lg xl`. The mapping is indices 1, 2, 3, 5 and 6,
  the same for all three directions, so no direction gets a rhythm the others
  did not. Index 3 is `md`, which is the page gutter, and it puts Foil & Midnight
  at exactly the 280px of usable width at 320px that the report measured its type
  against.

## What the report needed that the format did not have

Named here rather than bent quietly into one side or the other.

### The desktop column has no home

The report gives a mobile and a desktop value for every type role. The token
schema stores one size per role, and its comment says why: "These are the mobile
values. Guest pages are mobile first and tested at 320px, so the small end is the
designed end." So the mobile column landed and the desktop column did not. This
is a real gap for anyone opening an invitation on a laptop, and closing it is a
token schema change, either a second breakpoint per role or the fluid display
size the report's first finding also asks for. It is not made here because it is
a change every theme has to satisfy, and it deserves its own review.

### Which stack a type role uses became a token

Theme version 2. Before it, the block set decided the mapping for every theme at
once in `src/app/globals.css`: display and title took `font.heading`, body and
caption took `font.body`. Masthead cannot live with that. The report is explicit
that "Bodoni Moda is display-only in this direction", because its hairlines
disappear below roughly 32px, and its section headings are 24px on a phone. So
`typeScale.<role>.font` names `heading` or `body`, and Masthead sets its titles
in Archivo while its names stay in Bodoni Moda.

The report asked for this in as many words: "the token schema should not make
that mistake easy to make". The migration writes the old mapping into every
stored version 1 theme, so nothing that exists renders differently.

### `accentInk`, `border` and `critical` are roles the report has no value for

The report's palette is five roles and the format's is eight. Where the extra
three came from:

- **`accentInk`** is the report's own answer, moved into the schema. Its failing
  pairings table says a button filled with `accent` "takes its label from `bg` or
  `surface`, never from `ink`", and the passing table measures `bg` on `accent`.
  So `accentInk` is `bg` in every direction, and `themeColoursSchema` now refuses
  any theme where it is neither `bg` nor `surface`.
- **`border`** is `surface`. The report's third failing pairing is that `surface`
  against `bg` is about 1.1:1 in all three directions, on purpose, because a
  stationery card is separated by paper edge and margin rather than a colour
  step. Making the decorative rule token the same value states that as a property
  of the theme rather than as a paragraph. The block set draws no boundary from
  either: form controls use `inkMuted`, which is what the report says they have
  to use.
- **`critical`** is the one place a value was chosen rather than quoted. The
  report has no error colour, because an RSVP validation message is not something
  a design direction is about, and the schema requires one so that a block never
  reaches for a hardcoded red. The three are `#a3301f`, `#b3160b` and `#f2a79a`,
  each picked to sit in its direction's palette and each measured: they clear
  4.5:1 against both `bg` and `surface` in every direction, and those ratios are
  asserted with the rest in `tests/unit/template/contrast.test.ts`.

### The theme document has no name, and no place for a signature

A theme is `{ version, tokens }` and nothing else, which is the same rule the
`templates_theme_carries_no_blocks` constraint enforces in the database. So the
report's `name` field lives in the file name and in the table at the top of this
document, and the `signature` string lives in `src/lib/preview/fixture.ts`, where
it is copy on the preview index rather than a token.

## The three measured findings

Each one changed something. None was optional.

### The names block must stack

Measured in Chrome at 320px with the real fonts: "Emma & Jake" fits on one line
in all three directions and "Alexandra & Christopher" overflows in all three.
The sample content hides the failure, which is why the finding exists.

`HeroBlock` therefore renders the lockup as three block level lines, name,
ampersand, name, and `stackNames` is exported so the split is testable on its
own. The spaces between the lines are kept in the markup, so the heading's text
content is still one name and a screen reader does not read three fragments.
`break-words` stays for the case stacking cannot help with, which is one name
long enough to overflow by itself.

The report's other recommendation in this finding, a fluid display size, is not
made: it is a token schema change, and it is listed above with the desktop
column it belongs next to.

### The arch does not fit the radius token

Followed as the report resolved it: `radius` stays uniform at `sm md lg pill`
across every theme, and the arch is not a token. A theme document that adds an
`arch` key is rejected, and there is a test that loads one to prove it. The arch
is a variant of the media block selected by the template JSON, which is
definition work rather than theme work, and it is not built here. Neither are the
other two signature elements, for the same reason: none of the three is
expressible in tokens.

### Font payload

`src/app/fonts.ts` self hosts six faces through `next/font/google` with
`display: swap`: EB Garamond 400 with Karla 400 and 600, Bodoni Moda 400 with
Archivo 400 and 600, and Cinzel 400 with Jost 400. Foil & Midnight needs two
rather than three because the report found Jost 300 too thin to hold at 13px on a
low DPI LCD, so its caption weight is 400.

None of them is preloaded, and that is the whole mechanism. The guest page will
be one dynamic route serving every template, so a preload hint would put all six
families on every page. Without it a browser fetches a font file only when it has
a glyph to draw in it, so a guest opening a Masthead invitation downloads Bodoni
Moda and Archivo and nothing else. What all six do cost is their `@font-face`
rules, which is text in the route stylesheet rather than font payload.
`tests/e2e/themes.spec.ts` counts the font requests a real browser makes.

The two placeholder themes, `ivory` and `midnight`, load nothing. They are not
part of the template line and they keep falling back to Georgia and system-ui.

## Contrast, as tests rather than as prose

The report computed its table once, by hand, with the WCAG 2.1 relative
luminance formula. `src/lib/template/contrast.ts` implements the same formula and
`tests/unit/template/contrast.test.ts` recomputes every row from the committed
theme files. Three things are asserted, and the last two matter more than the
first:

1. the AA floor, for every pair the report lists as passing;
2. the published ratio to two decimal places, so a pair that slid from 8.16 to
   4.6 fails rather than passing a floor;
3. the three pairings that fail in all three directions, which are asserted to be
   unreachable rather than merely unused.

Unreachable is three separate mechanisms, because a rule that lives in one place
is a rule with one way around it:

| Pairing                   | What makes it impossible                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ink` on an `accent` fill | `themeColoursSchema` refuses a theme whose `accentInk` is not `bg` or `surface`, and `findContrastViolations` refuses a block that draws anything but `--color-accent-ink` on an accent fill |
| `accent` on an `ink` fill | `findContrastViolations` refuses an ink fill anywhere in the block set, so there is nothing to draw accent on                                                                                |
| `surface` as a boundary   | `findContrastViolations` refuses a border, ring, outline or divide drawn in `surface` or `border`; boundaries read `inkMuted`                                                                |

Alpha is refused outright: `hexColourSchema` rejects the eight digit form. The
report's rule is that an `inkMuted` border dimmed to 40% drops under 3.0:1, "so
the token set should not offer alpha variants of border colours", and a ratio
against a translucent colour is not computable in the first place.

Static guards cannot see a colour inherited across two elements, so
`tests/e2e/themes.spec.ts` walks the rendered page in a browser, works out what
is actually painted behind every piece of text, and measures it with the same
function. Pointing the RSVP button label at `--color-ink` makes it report 1.81,
2.10 and 1.73 to one, which are the report's own numbers.

## One value taken verbatim that is worth a second look

Masthead's radius is `{ sm: 0, md: 0, lg: 0, full: 999 }` in the report, and it
landed exactly that way, so the RSVP button is a pill on a page whose every other
edge is square. That is the report's value and it was not adjusted. If it reads
wrong on screen, the fix is a decision about that token, not about the block.
