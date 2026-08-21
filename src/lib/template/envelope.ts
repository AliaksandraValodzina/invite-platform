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

import { decorativePicture, optionalText } from './primitives'

export const envelopeConfigSchema = z.strictObject({
  /** The line above the names. "You are invited", "Save the date". */
  note: optionalText(80, 'Line on the cover'),
  /** The prompt that says the cover opens. The component has its own if this is absent. */
  openLabel: optionalText(40, 'Prompt to open'),
  /**
   * A picture of the envelope, replacing the one the block set draws from
   * tokens. This is what the buyer upload capability writes: an `envelope` kind
   * upload becomes exactly this object, built by `pictureFromUpload` in
   * src/lib/uploads/picture.ts.
   *
   * It is the envelope, not a backdrop, and it carries no alt key for the same
   * reason `hero.artwork` carries none: it is decoration, it says nothing the
   * page does not already say in words, and the component draws it with
   * `alt=""`. Drawing it as a full bleed background instead would put the
   * cover's own words on top of a picture, and this repo's rule is that no text
   * has its contrast measured against an image. See docs/envelope.md.
   */
  image: decorativePicture('Envelope picture', 'envelope').optional(),
})

export type EnvelopeConfig = z.infer<typeof envelopeConfigSchema>

/** What a template with nothing of its own resolves to: the universal envelope. */
export const UNIVERSAL_ENVELOPE: EnvelopeConfig = {}
