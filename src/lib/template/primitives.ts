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
export const httpsUrlSchema = z
  .string()
  .max(2048)
  .superRefine(checkHttpsUrl)
  /*
   * Metadata, not validation. `control` is the one thing the guided form reads
   * out of this format that a JSON Schema cannot say on its own: two fields can
   * both be "a string with a ceiling" and still need different controls in
   * front of a buyer. See src/lib/editor/fields.ts.
   */
  .meta({ control: 'url' })

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

/**
 * One stored width of one picture: an address, and how wide the file at it is.
 *
 * Each width is a separate content address, so they cannot be derived from one
 * another and every one has to be named. See src/lib/uploads/address.ts.
 */
export const pictureWidthSchema = z.strictObject({
  src: imageSourceSchema,
  /** CSS pixels of the stored file, which is the `w` descriptor in a srcset. */
  width: z.number().int().positive().max(8000),
})

const pictureShape = {
  /**
   * What a browser fetches when it does not read `srcset`, so it is the
   * SMALLEST stored width rather than the largest. An old phone that ignores
   * `srcset` is the one device that must not be handed 1600px.
   *
   * `/a/<key>` is the form an upload is named by. It carries no hostname,
   * because the hostname is a property of the deployment and is applied at
   * render time by `resolveAssetSrc`. See src/lib/uploads/host.ts.
   */
  src: imageSourceSchema,
  /**
   * Every stored width of the same picture, which is what lets a block emit a
   * real `srcset` instead of sending one size to every guest.
   *
   * It exists because the upload capability already produces more than one:
   * `UPLOAD_KIND_SPECS` re-encodes an image at three widths and an envelope at
   * two, and a content shape that could name only one of them would leave the
   * rest stored, counted against the event's variant budget, and never served.
   *
   * Absent means the one `src` is all there is, which is what an https URL
   * somebody pasted looks like.
   */
  widths: z.array(pictureWidthSchema).min(1).max(4).optional(),
} as const

/**
 * The two upload kinds a picture slot can be filled from.
 *
 * A slot says which because the capability re-encodes them differently and for
 * a stated reason: a photograph in the reading column is stored at 480, 960 and
 * 1600, and a cover drawn full bleed is stored at 800 and 1600 because the
 * smallest photo width would be visibly soft across a whole screen
 * (src/lib/uploads/kinds.ts).
 *
 * It is a bare string here and this module imports nothing from `uploads`, so
 * the format stays a document format. What it names is a property of the slot,
 * not of the object store: "this is a picture drawn across the page" is a fact
 * about the design, and the storage schedule follows from it rather than the
 * other way round.
 */
export type PictureSlot = 'image' | 'envelope'

function pictureMeta(label: string | undefined, slot: PictureSlot) {
  /*
   * `control: 'picture'` is what tells the guided form that these keys are one
   * thing a buyer swaps rather than three fields they fill in. It has to sit on
   * the OBJECT and not on `src`, because swapping the picture changes `src` and
   * `widths` together: a control that owned only the address would leave a
   * srcset pointing at the picture that was just replaced.
   */
  return {
    control: 'picture',
    uploadKind: slot,
    ...(label === undefined ? {} : { description: label }),
  }
}

/**
 * A picture that is decoration: it says nothing the page does not already say
 * in words, so it carries no alt text and there is nowhere to put any.
 *
 * The absence is the design. Nobody should ever be asked to transcribe words
 * baked into a picture, and a block draws one of these with `alt=""`.
 */
export function decorativePicture(label?: string, slot: PictureSlot = 'image') {
  return z.strictObject(pictureShape).meta(pictureMeta(label, slot))
}

/**
 * A picture that is content: a photograph of the couple, which means something,
 * and therefore carries alt text. Alt is required whenever there is a picture
 * at all, because it is content rather than polish.
 */
export function contentPicture(label?: string, altLabel = 'Describe the photo') {
  return z
    .strictObject({ ...pictureShape, alt: text(160, altLabel) })
    .meta(pictureMeta(label, 'image'))
}

/**
 * Required visible text with a hard ceiling, so no field can become a document.
 *
 * The optional `label` is the words a buyer reads above this field in the
 * guided form. It is a Zod description, which means it travels with the schema
 * rather than living in a table the editor keeps beside it: a field that gains
 * a label here gains it in the form, and a field that never gets one still gets
 * a form, drawn under a label made from its key. That is the whole reason the
 * editor can claim to be driven by the format. See src/lib/editor/fields.ts.
 *
 * It is written before `.optional()` and never after, because that is where
 * `z.toJSONSchema` reads a description from for a property that may be absent.
 */
export function text(max: number, label?: string) {
  const schema = z.string().trim().min(1).max(max)
  return label === undefined ? schema : schema.describe(label)
}

/**
 * Optional visible text. Absent and empty are the same thing to a renderer, so
 * an empty string is rejected rather than quietly rendering an empty element.
 */
export function optionalText(max: number, label?: string) {
  return text(max, label).optional()
}

/** Builds an object shape that maps every key in a fixed role list to one schema. */
export function shapeFromRoles<Role extends string, Schema extends z.ZodType>(
  roles: readonly Role[],
  schema: Schema
): { [K in Role]: Schema } {
  return Object.fromEntries(roles.map((role) => [role, schema])) as { [K in Role]: Schema }
}
