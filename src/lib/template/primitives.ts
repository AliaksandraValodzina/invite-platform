/**
 * Shared value schemas used across every document in the template format.
 *
 * These are deliberately narrow. A template document is written by us and later
 * by a buyer through a guided form, then rendered into a public page, so every
 * value that ends up in HTML or CSS is constrained here rather than in the block
 * that happens to consume it.
 */

import { z } from 'zod'

/**
 * Block ids, template keys and theme keys all share one shape. Lower case words
 * joined by single hyphens, which is also the shape of an event slug, so there
 * is one identifier convention in the product rather than three.
 */
export const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lower case words joined by single hyphens')

/**
 * Hex only. Named colours and `var(...)` expressions are rejected on purpose:
 * a token is written into a CSS custom property, and a token that can hold an
 * arbitrary CSS expression is a way to put arbitrary CSS on a guest page. Hex
 * also stays machine readable, which is what a later contrast check needs.
 */
export const hexColourSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
    'must be a hex colour such as #1b1b1f, #fff or #1b1b1fcc'
  )

/**
 * https only, for every URL anywhere in the format. `javascript:` and `data:`
 * are the reason, and mixed content warnings on a guest page are the other one.
 */
export const httpsUrlSchema = z
  .string()
  .max(2048)
  .superRefine((value, ctx) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be an absolute URL' })
      return
    }

    if (parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        message: `must use https, got "${parsed.protocol}"`,
      })
    }
  })

/** Required visible text with a hard ceiling, so no field can become a document. */
export function text(max: number) {
  return z.string().trim().min(1).max(max)
}

/**
 * Optional visible text. Absent and empty are the same thing to a renderer, so
 * an empty string is rejected rather than quietly rendering an empty element.
 */
export function optionalText(max: number) {
  return text(max).optional()
}

/** Builds an object shape that maps every key in a fixed role list to one schema. */
export function shapeFromRoles<Role extends string, Schema extends z.ZodType>(
  roles: readonly Role[],
  schema: Schema
): { [K in Role]: Schema } {
  return Object.fromEntries(roles.map((role) => [role, schema])) as { [K in Role]: Schema }
}
