/**
 * The buyer's palette: eight colour roles, read off a form and written as a
 * theme override.
 *
 * Pure, and it is where three decisions live.
 *
 * ## The guest page degrades; this form does not decide that
 *
 * `resolveEventPage` falls back to the template's theme when a stored override
 * does not validate, and reports it rather than failing the page
 * (src/lib/template/resolve.ts). That behaviour is the safety net under
 * everything here and it is deliberately untouched: an invitation in the wrong
 * palette still tells guests where to be, and one that refuses to render does
 * not. So nothing on the read path was tightened to make this stage work.
 *
 * What this module does instead is make an unrenderable palette hard to compose
 * in the first place. Every colour is a colour input, so a browser hands back a
 * hex; `accentInk` is not a colour input at all, for the reason below. A save
 * that cannot read a value refuses and names the field, which is a form telling
 * you which box is wrong, and it writes nothing.
 *
 * ## accentInk is a choice, not a colour
 *
 * The token schema requires `accentInk` to be the same value as `bg` or
 * `surface`: a label on an accent fill is drawn in the page or card colour and
 * never in ink, because that pairing failed in all three design directions at
 * about 2:1 (src/lib/template/theme.ts). Offering it as a ninth colour input
 * would offer a rule the schema then refuses, so it is offered as the choice it
 * actually is, and the failing pairing stays unreachable from the form.
 *
 * ## Contrast is reported, never enforced here
 *
 * `contrastFindings` recomputes the same pairs the committed themes are
 * asserted on (tests/unit/template/contrast.test.ts) and hands them back with
 * their floors. The editor shows the ones that fail. It does not block a save:
 * the palette is the buyer's, they may be picking colours for a reason we
 * cannot see, and refusing would mean a product that argues with the person who
 * paid for it. Telling them their guests will struggle to read it is the honest
 * thing that is also true.
 */

import {
  AA_NORMAL_TEXT,
  COLOUR_ROLES,
  CURRENT_THEME_VERSION,
  contrastRatioTo2dp,
  hexColourSchema,
  themeColoursSchema,
  type ColourRole,
  type ThemeOverrideDocument,
  type ThemeTokens,
} from '@/lib/template'

import type { SaveIssue } from './result'

export type PaletteColours = ThemeTokens['color']

/** The roles a buyer picks a colour for. `accentInk` is derived; see below. */
export const BUYER_COLOUR_ROLES = COLOUR_ROLES.filter(
  (role): role is Exclude<ColourRole, 'accentInk'> => role !== 'accentInk'
)

/**
 * Which of the two buttons on the colours form was pressed: saving a palette,
 * or going back to the template's.
 *
 * Here rather than beside the action, because a `'use server'` module may only
 * export async functions and this is a string. Both ends of the form need it.
 */
export const PALETTE_FIELD = 'palette'
export const PALETTE_RESET = 'reset'

/** Which of the two the label on an accent fill is drawn in. */
export const ACCENT_INK_FIELD = 'accentInk'
export const ACCENT_INK_CHOICES = ['bg', 'surface'] as const
export type AccentInkChoice = (typeof ACCENT_INK_CHOICES)[number]

/** The words a buyer reads above each colour control. */
export const COLOUR_LABELS: Readonly<Record<ColourRole, string>> = {
  bg: 'The page',
  surface: 'Cards on the page',
  ink: 'Text',
  inkMuted: 'Quieter text, such as captions',
  accent: 'Highlights and buttons',
  accentInk: 'Text on a button',
  border: 'Lines and edges',
  critical: 'Errors on the reply form',
}

export function colourFieldName(role: ColourRole): string {
  return `colour.${role}`
}

export type PaletteRead =
  | { readonly ok: true; readonly colours: PaletteColours }
  | { readonly ok: false; readonly issues: readonly SaveIssue[] }

/**
 * The submitted palette, or the fields that could not be read.
 *
 * A server action is reachable by a direct POST, so this parses rather than
 * trusting that a colour input was on the other end.
 */
export function readPalette(formData: FormData): PaletteRead {
  const issues: SaveIssue[] = []
  const values: Record<string, string> = {}

  /*
   * Each swatch is checked here rather than only through the whole group below,
   * so that an unreadable value is reported against the control the buyer can
   * see. `accentInk` is derived from one of these, and reporting it separately
   * would name a field path with no control behind it: two messages about one
   * mistake, one of which cannot be acted on.
   */
  for (const role of BUYER_COLOUR_ROLES) {
    const raw = String(formData.get(colourFieldName(role)) ?? '').trim()
    if (raw === '') {
      issues.push({ path: colourFieldName(role), message: 'needs a colour' })
      continue
    }

    const parsed = hexColourSchema.safeParse(raw)
    if (!parsed.success) {
      issues.push({
        path: colourFieldName(role),
        message: parsed.error.issues[0]?.message ?? 'must be a colour',
      })
      continue
    }

    values[role] = parsed.data
  }

  const choice = String(formData.get(ACCENT_INK_FIELD) ?? '')
  if (!isAccentInkChoice(choice)) {
    issues.push({
      path: ACCENT_INK_FIELD,
      message: 'must say whether a button label is drawn in the page colour or the card colour',
    })
  } else {
    const derived = values[choice]
    // Absent only when that role failed to read, which is already an issue.
    if (derived !== undefined) values.accentInk = derived
  }

  if (issues.length > 0) return { ok: false, issues }

  /*
   * The token schema is the only thing that says yes, here as everywhere else
   * in this repo. It is what rejects `rebeccapurple`, an eight digit hex whose
   * contrast cannot be computed, and the accentInk rule if this module ever
   * stops deriving it correctly.
   */
  const parsed = themeColoursSchema.safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.length === 0 ? 'colour' : `colour.${issue.path.join('.')}`,
        message: issue.message,
      })),
    }
  }

  return { ok: true, colours: parsed.data }
}

function isAccentInkChoice(value: string): value is AccentInkChoice {
  return (ACCENT_INK_CHOICES as readonly string[]).includes(value)
}

/** Which choice a stored palette's `accentInk` corresponds to. */
export function accentInkChoiceOf(colours: PaletteColours): AccentInkChoice {
  return colours.accentInk === colours.surface && colours.surface !== colours.bg ? 'surface' : 'bg'
}

/**
 * The palette as a theme override document.
 *
 * A palette identical to the template's own is stored as no override at all,
 * which is the same rule the words follow: an event that has overridden nothing
 * keeps tracking the template, so a palette we later correct reaches it.
 *
 * The colour group is written whole and never a subset, because that is what
 * `themeOverrideDocumentSchema` says a group is. A half merged palette is the
 * shape that produces unreadable text on somebody's wedding page.
 */
export function paletteOverride(
  colours: PaletteColours,
  templateColours: PaletteColours
): ThemeOverrideDocument {
  const same = COLOUR_ROLES.every((role) => colours[role] === templateColours[role])

  return {
    version: CURRENT_THEME_VERSION,
    tokens: same ? {} : { color: colours },
  }
}

/** The override that puts an event back on its template's palette. */
export const NO_PALETTE_OVERRIDE: ThemeOverrideDocument = {
  version: CURRENT_THEME_VERSION,
  tokens: {},
}

export type ContrastFinding = {
  /** What the pair is used for, in the words the design directions report used. */
  readonly usedFor: string
  readonly foreground: ColourRole
  readonly background: ColourRole
  readonly ratio: number
  readonly required: number
  readonly passes: boolean
}

/**
 * Every pair a block can actually produce, which is the table
 * data/ip-design-directions/report.md computed by hand and
 * tests/unit/template/contrast.test.ts asserts for the committed themes.
 *
 * The two accent fill rows name `bg` and `surface` as the label colour rather
 * than `accentInk`, because that is what `accentInk` is: the schema pins it to
 * one of the two, and checking both is what tells a buyer that the choice they
 * did not make would have been worse.
 */
const PAIRS: readonly {
  readonly usedFor: string
  readonly fg: ColourRole
  readonly bg: ColourRole
  readonly required: number
}[] = [
  { usedFor: 'Body text on the page', fg: 'ink', bg: 'bg', required: AA_NORMAL_TEXT },
  { usedFor: 'Body text on a card', fg: 'ink', bg: 'surface', required: AA_NORMAL_TEXT },
  { usedFor: 'Captions on the page', fg: 'inkMuted', bg: 'bg', required: AA_NORMAL_TEXT },
  /*
   * This row does double duty and it is worth saying so, because the pair that
   * looks missing from this list is `border`.
   *
   * `border` in this block set draws decorative rules, and every committed theme
   * sets it as a hairline: 1.08:1 in Deckle & Deboss, 1.14 in Masthead, 1.17 in
   * Foil & Midnight. Holding it to the 3.0 WCAG asks of a non text boundary
   * would report every design we sell as failing, which is a warning that is
   * wrong by our own design and therefore a warning nobody reads twice.
   *
   * What a guest does have to find is the outline of a reply form field, and
   * `src/components/blocks/rsvp-form-block.tsx` draws that in `inkMuted` on
   * `surface`, which is this row, measured at the stricter text floor. If a
   * control outline ever moves to `border`, this comment is where whoever does
   * it finds out that the token schema has to move with it.
   */
  { usedFor: 'Captions on a card', fg: 'inkMuted', bg: 'surface', required: AA_NORMAL_TEXT },
  { usedFor: 'Highlighted text on the page', fg: 'accent', bg: 'bg', required: AA_NORMAL_TEXT },
  { usedFor: 'Highlighted text on a card', fg: 'accent', bg: 'surface', required: AA_NORMAL_TEXT },
  { usedFor: 'A button label', fg: 'accentInk', bg: 'accent', required: AA_NORMAL_TEXT },
  { usedFor: 'An error on the reply form', fg: 'critical', bg: 'bg', required: AA_NORMAL_TEXT },
]

export function contrastFindings(colours: PaletteColours): readonly ContrastFinding[] {
  return PAIRS.map((pair) => {
    const ratio = contrastRatioTo2dp(colours[pair.fg], colours[pair.bg])
    return {
      usedFor: pair.usedFor,
      foreground: pair.fg,
      background: pair.bg,
      ratio,
      required: pair.required,
      passes: ratio >= pair.required,
    }
  })
}

/** Only the pairs a guest would struggle with. Shown; never a refusal. */
export function contrastWarnings(colours: PaletteColours): readonly ContrastFinding[] {
  return contrastFindings(colours).filter((finding) => !finding.passes)
}
