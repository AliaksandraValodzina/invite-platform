/**
 * The envelope: the cover a guest sees before the invitation.
 *
 * It is not a block, and that is the whole shape of this feature. A block is a
 * section of the page, drawn in the reading column, in the order the definition
 * lists it. The envelope is something drawn OVER that page, and the page
 * underneath is complete and reachable whether or not the envelope ever opens.
 * So it is a key on the definition document beside `blocks` rather than a sixth
 * entry inside it, and `BLOCK_CONFIG_SCHEMAS` still holds five types.
 *
 * Every field is optional, which is what makes the universal envelope real
 * rather than a special case in a component. A template that says nothing about
 * an envelope, and a buyer who cleared every field out of the guided form, both
 * resolve to the same empty config, and the component draws the plain envelope
 * from theme tokens and its own copy. There is no `enabled` flag: an invitation
 * arrives in an envelope. If a template ever needs to refuse one, that is a new
 * optional field, which by docs/template-format.md is a version bump with no
 * rewrite.
 *
 * What is deliberately NOT here:
 *
 *   a headline. The cover shows the invitation's own headline, read off the
 *   resolved hero the same way the share card reads its kicker
 *   (src/lib/og/event.ts). Storing it here would be a second copy of the
 *   couple's names, in a second field of the guided form, that can disagree
 *   with the first one.
 *
 *   any colour, radius or type value. The envelope is drawn from theme tokens
 *   like everything else, which is what makes three design directions produce
 *   three different envelopes with no new artwork.
 */

import { z } from 'zod'

import { imageSourceSchema, optionalText } from './primitives'

export const envelopeConfigSchema = z.strictObject({
  /** The line above the names. "You are invited", "Save the date". */
  note: optionalText(80),
  /** The prompt that says the cover opens. The component has its own if this is absent. */
  openLabel: optionalText(40),
  /**
   * A picture of the envelope, replacing the one the block set draws from
   * tokens. This is what the buyer upload capability writes: an `envelope` kind
   * upload becomes exactly this object, built by `envelopeImageFromUpload` in
   * src/lib/uploads/envelope.ts.
   *
   * It is the envelope, not a backdrop, and it carries no alt key for the same
   * reason `hero.artwork` carries none: it is decoration, it says nothing the
   * page does not already say in words, and the component draws it with
   * `alt=""`. Drawing it as a full bleed background instead would put the
   * cover's own words on top of a picture, and this repo's rule is that no text
   * has its contrast measured against an image. See docs/envelope.md.
   */
  image: z
    .strictObject({
      /**
       * What a browser fetches when it does not read `widths`, so it is the
       * SMALLEST stored width rather than the largest. An old phone that
       * ignores `srcset` is the one device that must not be handed 1600px.
       *
       * `/a/<key>` is the form an upload is named by. It carries no hostname,
       * because the hostname is a property of the deployment and is applied at
       * render time by `resolveAssetSrc`. See src/lib/uploads/host.ts.
       */
      src: imageSourceSchema,
      /**
       * Every stored width of the same picture, which is what lets the cover
       * emit a real `srcset` instead of sending one size to every guest.
       *
       * It exists because the upload capability already produces more than one.
       * `UPLOAD_KIND_SPECS.envelope` re-encodes an envelope to 800 and 1600
       * CSS pixels; a content shape that could only name one of them would
       * leave the other stored, counted against the event's variant budget,
       * and never served. Each width is a separate content address, so they
       * cannot be derived from one another and all of them have to be named.
       *
       * Absent means the one `src` is all there is, which is what an https URL
       * somebody pasted looks like.
       */
      widths: z
        .array(
          z.strictObject({
            src: imageSourceSchema,
            /** CSS pixels of the stored file, which is the `w` descriptor. */
            width: z.number().int().positive().max(8000),
          })
        )
        .min(1)
        .max(4)
        .optional(),
    })
    .optional(),
})

export type EnvelopeConfig = z.infer<typeof envelopeConfigSchema>

/** What a template with nothing of its own resolves to: the universal envelope. */
export const UNIVERSAL_ENVELOPE: EnvelopeConfig = {}
