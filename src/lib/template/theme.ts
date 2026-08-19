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

import { createDocumentPipeline, type DocumentMigration } from './document'
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
export const SPACE_STEPS = ['xs', 'sm', 'md', 'lg', 'xl'] as const
export const RADIUS_STEPS = ['sm', 'md', 'lg', 'pill'] as const

export type ColourRole = (typeof COLOUR_ROLES)[number]
export type TypeRole = (typeof TYPE_ROLES)[number]
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

export const themeTokensSchema = z.strictObject({
  color: z.strictObject(shapeFromRoles(COLOUR_ROLES, hexColourSchema)),
  font: z.strictObject({ heading: fontStackSchema, body: fontStackSchema }),
  typeScale: z.strictObject(shapeFromRoles(TYPE_ROLES, typeStepSchema)),
  space: z.strictObject(shapeFromRoles(SPACE_STEPS, spaceStepSchema)),
  radius: z.strictObject(shapeFromRoles(RADIUS_STEPS, radiusStepSchema)),
})

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
    color: themeTokensSchema.shape.color.optional(),
    font: themeTokensSchema.shape.font.optional(),
    typeScale: themeTokensSchema.shape.typeScale.optional(),
    space: themeTokensSchema.shape.space.optional(),
    radius: themeTokensSchema.shape.radius.optional(),
  }),
})

export type ThemeOverrideDocument = z.infer<typeof themeOverrideDocumentSchema>

/**
 * The theme document versions independently of the definition. Adding a token
 * role is not the same change as adding a block, and forcing them to share a
 * number would mean every restyle invalidates every stored definition.
 */
export const CURRENT_THEME_VERSION = 1

export const THEME_MIGRATIONS: readonly DocumentMigration[] = []

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

  variables['--font-heading'] = tokens.font.heading
  variables['--font-body'] = tokens.font.body

  for (const role of TYPE_ROLES) {
    const step = tokens.typeScale[role]
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
