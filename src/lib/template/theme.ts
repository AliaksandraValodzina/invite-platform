/**
 * Theme tokens: the whole visual vocabulary a block is allowed to use.
 *
 * Two rules make this file worth reading.
 *
 * Colour tokens are ROLES, not usages. `accent` can be re-themed; `buttonPink`
 * cannot, because the name has already decided where it is allowed to appear.
 * The role list is closed on purpose: if a block needs a colour that is not in
 * it, the answer is a new role here, never a literal in the block.
 *
 * The theme is its own document with its own version. It is stored in its own
 * column (`templates.theme`, `event_content.theme`) and it never contains
 * content. That separation is what later lets a buyer pick a palette without
 * anything touching the structure of their page.
 */

import { z } from 'zod'

import {
  createDocumentPipeline,
  isJsonObject,
  type DocumentMigration,
  type JsonObject,
} from './document'
import { hexColourSchema, shapeFromRoles } from './primitives'

/**
 * `accentInk` exists so a block never has to guess that text on `accent` is
 * white. `critical` covers RSVP validation errors, which is the one place a
 * block would otherwise reach for a hardcoded red.
 *
 * A theme is responsible for keeping `ink` legible on both `bg` and `surface`.
 * That is a theme author's job, not a per block override.
 */
export const COLOUR_ROLES = [
  'bg',
  'surface',
  'ink',
  'inkMuted',
  'accent',
  'accentInk',
  'border',
  'critical',
] as const

export const TYPE_ROLES = ['display', 'title', 'body', 'caption'] as const
export const FONT_ROLES = ['heading', 'body'] as const
export const SPACE_STEPS = ['xs', 'sm', 'md', 'lg', 'xl'] as const
export const RADIUS_STEPS = ['sm', 'md', 'lg', 'pill'] as const

export type ColourRole = (typeof COLOUR_ROLES)[number]
export type TypeRole = (typeof TYPE_ROLES)[number]
export type FontRole = (typeof FONT_ROLES)[number]
export type SpaceStep = (typeof SPACE_STEPS)[number]
export type RadiusStep = (typeof RADIUS_STEPS)[number]

/**
 * A font stack, not a font file. Semicolons, braces and parentheses are
 * rejected for the same reason colours are hex only: this string is written
 * into a CSS custom property.
 */
export const fontStackSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9 ,'"-]+$/,
    'may only contain letters, digits, spaces, commas, quotes and hyphens'
  )

/**
 * One step of the type scale. Sizes are rem numbers rather than strings so they
 * stay arithmetic: a renderer can clamp or scale them, and a string like `2rem`
 * would have to be parsed back before it could.
 *
 * These are the mobile values. Guest pages are mobile first and tested at 320px,
 * so the small end is the designed end.
 */
export const typeStepSchema = z.strictObject({
  /**
   * Which of the two stacks this role is set in.
   *
   * This arrived in theme version 2, and the reason is a measured one. The
   * Masthead direction pairs Bodoni Moda with Archivo, and the design
   * directions report is explicit that "Bodoni Moda is display-only in this
   * direction", because its hairlines disappear below roughly 32px and its
   * section headings are 24px on a phone. Before this field, the block set
   * decided the mapping for every theme at once (display and title take the
   * heading stack, body and caption take the body stack), so Masthead could not
   * express a section heading set in its grotesque without every other theme
   * moving with it.
   *
   * The report asked for exactly this: "the token schema should not make that
   * mistake easy to make". It also keeps the font payload honest, since a
   * theme's face count is now readable straight off its own tokens rather than
   * inferred from a rule living in a stylesheet.
   */
  font: z.enum(FONT_ROLES),
  /** rem */
  size: z.number().min(0.5).max(8),
  /** unitless multiplier */
  lineHeight: z.number().min(0.9).max(2.5),
  weight: z.number().int().min(100).max(900).multipleOf(100),
  /** em, optional because most steps do not need it */
  tracking: z.number().min(-0.1).max(0.5).optional(),
})

/** rem */
export const spaceStepSchema = z.number().min(0).max(12)
/** rem. `pill` is conventionally a large number rather than a keyword. */
export const radiusStepSchema = z.number().min(0).max(999)

/**
 * The colour group on its own, so the rule below can be applied both to a full
 * theme and to a buyer's palette override, which supplies the same group whole.
 */
export const themeColoursSchema = z
  .strictObject(shapeFromRoles(COLOUR_ROLES, hexColourSchema))
  .superRefine((colours, ctx) => {
    /*
     * `ink` on an `accent` fill is the first of the three pairings the design
     * directions report found failing in all three directions, at 1.81, 2.10 and
     * 1.73 to one. Its rule is quoted here because this is where it is enforced:
     * "A button or badge filled with `accent` takes its label from `bg` or
     * `surface`, never from `ink`."
     *
     * `accentInk` is the only colour the block set is allowed to draw on an
     * accent fill, so pinning it to one of those two values is what makes the
     * failing pairing unrepresentable rather than merely undrawn. It is a
     * structural rule rather than a contrast floor on purpose: a floor is a
     * property of one palette, and this has to hold for a palette nobody has
     * written yet.
     */
    if (colours.accentInk !== colours.bg && colours.accentInk !== colours.surface) {
      ctx.addIssue({
        code: 'custom',
        path: ['accentInk'],
        message:
          'must be the same value as bg or surface: a label on an accent fill is drawn in the page or card colour, never in ink',
      })
    }
  })

const themeTokensShape = {
  color: themeColoursSchema,
  font: z.strictObject(shapeFromRoles(FONT_ROLES, fontStackSchema)),
  typeScale: z.strictObject(shapeFromRoles(TYPE_ROLES, typeStepSchema)),
  space: z.strictObject(shapeFromRoles(SPACE_STEPS, spaceStepSchema)),
  radius: z.strictObject(shapeFromRoles(RADIUS_STEPS, radiusStepSchema)),
}

export const themeTokensSchema = z.strictObject(themeTokensShape)

export type ThemeTokens = z.infer<typeof themeTokensSchema>

export const themeDocumentSchema = z.strictObject({
  version: z.number().int().positive(),
  tokens: themeTokensSchema,
})

export type ThemeDocument = z.infer<typeof themeDocumentSchema>

/**
 * A buyer's theme override, stored on `event_content.theme`.
 *
 * A group is either absent or supplied whole. That is not a limitation, it is
 * what a palette is: picking "midnight" replaces every colour role at once.
 * Partial groups would mean merging token by token, and a half merged palette
 * is the shape that produces unreadable text on somebody's wedding page.
 */
export const themeOverrideDocumentSchema = z.strictObject({
  version: z.number().int().positive(),
  tokens: z.strictObject({
    color: themeTokensShape.color.optional(),
    font: themeTokensShape.font.optional(),
    typeScale: themeTokensShape.typeScale.optional(),
    space: themeTokensShape.space.optional(),
    radius: themeTokensShape.radius.optional(),
  }),
})

export type ThemeOverrideDocument = z.infer<typeof themeOverrideDocumentSchema>

/**
 * The theme document versions independently of the definition. Adding a token
 * role is not the same change as adding a block, and forcing them to share a
 * number would mean every restyle invalidates every stored definition.
 */
export const CURRENT_THEME_VERSION = 2

/**
 * Version 1 had no `font` on a type step. The block set decided the mapping for
 * every theme at once, in `src/app/globals.css`: display and title took the
 * heading stack, body and caption took the body stack.
 *
 * So that is exactly what this migration writes, which is the rule for a new
 * required field: supply the value that reproduces the old rendering behaviour,
 * so a stored version 1 theme looks the day after this ships exactly as it
 * looked the day before.
 *
 * It has to survive a partial document, because `event_content.theme` defaults
 * to `{"version": 1, "tokens": {}}` in the database and a buyer who has chosen
 * nothing has no `typeScale` group at all. A migration that assumed the group
 * was there would turn every untouched event into a failed read.
 */
const FONT_BY_TYPE_ROLE_V1: Readonly<Record<TypeRole, FontRole>> = {
  display: 'heading',
  title: 'heading',
  body: 'body',
  caption: 'body',
}

const addTypeStepFont: DocumentMigration = {
  from: 1,
  to: 2,
  description: 'gives every type role the font stack the block set used to choose for it',
  migrate: (document) => {
    const tokens = document.tokens
    if (!isJsonObject(tokens)) return { ...document, version: 2 }

    const typeScale = tokens.typeScale
    if (!isJsonObject(typeScale)) return { ...document, version: 2 }

    const migrated: JsonObject = {}
    for (const [role, step] of Object.entries(typeScale)) {
      migrated[role] =
        isJsonObject(step) && role in FONT_BY_TYPE_ROLE_V1
          ? { font: FONT_BY_TYPE_ROLE_V1[role as TypeRole], ...step }
          : step
    }

    return { ...document, version: 2, tokens: { ...tokens, typeScale: migrated } }
  },
}

export const THEME_MIGRATIONS: readonly DocumentMigration[] = [addTypeStepFont]

export const themePipeline = createDocumentPipeline<ThemeDocument>({
  name: 'theme',
  version: CURRENT_THEME_VERSION,
  schema: themeDocumentSchema,
  migrations: THEME_MIGRATIONS,
})

export const themeOverridePipeline = createDocumentPipeline<ThemeOverrideDocument>({
  name: 'theme override',
  version: CURRENT_THEME_VERSION,
  schema: themeOverrideDocumentSchema,
  migrations: THEME_MIGRATIONS,
})

/** The override the schema defaults to in the database when a buyer has chosen nothing. */
export const EMPTY_THEME_OVERRIDE: ThemeOverrideDocument = {
  version: CURRENT_THEME_VERSION,
  tokens: {},
}

/** Group level replace. See themeOverrideDocumentSchema for why it is not deeper. */
export function mergeThemeTokens(
  base: ThemeTokens,
  override: ThemeOverrideDocument['tokens']
): ThemeTokens {
  return {
    color: override.color ?? base.color,
    font: override.font ?? base.font,
    typeScale: override.typeScale ?? base.typeScale,
    space: override.space ?? base.space,
    radius: override.radius ?? base.radius,
  }
}

/**
 * The first family in a stack, unquoted.
 *
 * A theme's first entry is its choice; everything after it is what to do when
 * that choice is unavailable. So this is the family a page has to load, and the
 * rest is the chain it falls back through while it loads or if it never does.
 */
export function primaryFamily(stack: string): string {
  const first = /^\s*(?:'([^']+)'|"([^"]+)"|([^,]+))/.exec(stack)
  return (first?.[1] ?? first?.[2] ?? first?.[3] ?? '').trim()
}

export type Face = { readonly family: string; readonly weight: number }

/**
 * The distinct faces a theme actually needs, one per family and weight it sets
 * type in.
 *
 * This exists because of the font payload finding in
 * data/ip-design-directions/report.md: "each direction loads at most three
 * faces: display 400, body 400, body 600", and "three directions must not mean
 * loading three full webfont families on every page". Deriving the count from
 * the tokens rather than from what happens to be declared in
 * `src/app/fonts.ts` is what lets a test hold the two to each other.
 */
export function themeFaces(tokens: ThemeTokens): Face[] {
  const seen = new Map<string, Face>()

  for (const role of TYPE_ROLES) {
    const step = tokens.typeScale[role]
    const face = { family: primaryFamily(tokens.font[step.font]), weight: step.weight }
    seen.set(`${face.family} ${face.weight}`, face)
  }

  return [...seen.values()]
}

/**
 * The only bridge between tokens and CSS.
 *
 * Blocks read these custom properties and nothing else, which is what makes
 * "no hardcoded colour, font, radius or spacing value inside a block" a rule
 * that can actually be followed. The naming is fixed here so the next task does
 * not have to invent it.
 */
export function themeToCssVariables(tokens: ThemeTokens): Record<string, string> {
  const variables: Record<string, string> = {}

  for (const role of COLOUR_ROLES) {
    variables[`--color-${kebab(role)}`] = tokens.color[role]
  }

  for (const role of FONT_ROLES) {
    variables[`--font-${role}`] = tokens.font[role]
  }

  for (const role of TYPE_ROLES) {
    const step = tokens.typeScale[role]
    /*
     * The stack itself, resolved here rather than as `var(--font-heading)`, so a
     * type utility reads one custom property instead of chasing a second one.
     * This is the token that lets Masthead set its section headings in Archivo
     * while its names stay in Bodoni Moda.
     */
    variables[`--text-${role}-family`] = tokens.font[step.font]
    variables[`--text-${role}-size`] = `${step.size}rem`
    variables[`--text-${role}-line`] = `${step.lineHeight}`
    variables[`--text-${role}-weight`] = `${step.weight}`
    variables[`--text-${role}-tracking`] = `${step.tracking ?? 0}em`
  }

  for (const step of SPACE_STEPS) {
    variables[`--space-${step}`] = `${tokens.space[step]}rem`
  }

  for (const step of RADIUS_STEPS) {
    variables[`--radius-${step}`] = `${tokens.radius[step]}rem`
  }

  return variables
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}
