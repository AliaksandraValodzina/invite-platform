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
 * Hex only, and opaque. Named colours and `var(...)` expressions are rejected on
 * purpose: a token is written into a CSS custom property, and a token that can
 * hold an arbitrary CSS expression is a way to put arbitrary CSS on a guest
 * page. Hex also stays machine readable, which is what the contrast check in
 * `contrast.ts` needs.
 *
 * The eight digit form is rejected for the same reason, one step further on.
 * A contrast ratio against a translucent colour is not computable without
 * knowing every layer behind it, so a token that carries alpha is a token whose
 * legibility cannot be asserted. The design directions report reached this from
 * the other end: an `inkMuted` border dimmed to 40% alpha drops under the 3.0:1
 * a non text boundary needs, "so the token set should not offer alpha variants
 * of border colours". The token set therefore offers none at all.
 */
export const hexColourSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
    'must be an opaque hex colour such as #1b1b1f or #fff; alpha is not allowed because contrast has to stay computable'
  )

/**
 * https only, for every URL anywhere in the format. `javascript:` and `data:`
 * are the reason, and mixed content warnings on a guest page are the other one.
 */
export const httpsUrlSchema = z.string().max(2048).superRefine(checkHttpsUrl)

function checkHttpsUrl(value: string, ctx: z.RefinementCtx): void {
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
}

/**
 * A path to a file this app serves itself, such as
 * `/samples/unlicensed-placeholder/floral-band-UNLICENSED-PLACEHOLDER.jpg`.
 *
 * It exists because the template line ships artwork of its own. Artwork that
 * arrives from a third party host is a request a guest page makes to somebody
 * else's server on bad wifi, and it is a URL that can stop resolving long after
 * the invitation was sent. An app served path has neither problem.
 *
 * It is a path and never a URL, so there is no origin to get wrong and no
 * protocol to downgrade. Two shapes are rejected on top of that: a leading `//`,
 * which a browser reads as a protocol relative URL to another host, and a `..`
 * segment, which is a way to aim a stored document at something outside the
 * asset directory.
 *
 * The extension list is closed and holds no `svg`. An SVG is a document that can
 * carry script, and one served from our own origin would be same origin with
 * the guest page.
 */
const APP_ASSET_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:avif|webp|png|jpe?g)$/

/**
 * Where a picture on a guest page may come from: an https URL, or a file this
 * app serves. One schema rather than a union so that a bad value gets the
 * message for the kind of source it was clearly trying to be, instead of "no
 * branch matched".
 */
export const imageSourceSchema = z
  .string()
  .max(2048)
  .superRefine((value, ctx) => {
    if (!value.startsWith('/')) {
      checkHttpsUrl(value, ctx)
      return
    }

    if (value.startsWith('//')) {
      ctx.addIssue({
        code: 'custom',
        message: 'must not start with "//", which a browser reads as another host',
      })
      return
    }

    if (value.split('/').includes('..')) {
      ctx.addIssue({ code: 'custom', message: 'must not contain a ".." segment' })
      return
    }

    if (!APP_ASSET_PATH.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'must be an app served path ending in .avif, .webp, .png, .jpg or .jpeg, ' +
          'or an absolute https URL',
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
