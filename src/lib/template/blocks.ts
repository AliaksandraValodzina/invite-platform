/**
 * The five v1 blocks and their config schemas.
 *
 * Five, and no more. hero, details, countdown, map, rsvp-form is the set that
 * an $18 to $49 invitation needs, and every extra block is a block the guided
 * form has to explain.
 *
 * Three rules hold across all of them.
 *
 * 1. Config is CONTENT. No colour, font, radius or spacing value appears here,
 *    because those live in the theme document and reach a block as tokens.
 * 2. Nothing here duplicates the event row. The date, the time zone and the
 *    slug live on `events` and are the source of truth for the countdown. A
 *    block config that carried a date would be a second answer to "when is it",
 *    and the time zone correctness rule would stop being enforceable.
 * 3. No schema uses `.default()`. Optional means optional, and a field that
 *    later becomes required arrives with a version migration rather than a
 *    silent default. Parsing therefore never adds a key that was not stored,
 *    and the only normalisation anywhere is trimming surrounding whitespace on
 *    text. That is what makes it safe to parse a buyer's content on every
 *    render without ever writing it back.
 */

import { z } from 'zod'

import { contentPicture, decorativePicture, httpsUrlSchema, optionalText, text } from './primitives'

// hero ----------------------------------------------------------------------

export const heroConfigSchema = z.strictObject({
  eyebrow: optionalText(60, 'Line above the names'),
  headline: text(120, 'Names'),
  subhead: optionalText(200, 'Line below the names'),
  /**
   * A photograph of the couple, drawn inside the reading column.
   *
   * It is a `contentPicture`, so alt is required whenever there is one at all,
   * and its address may be an upload as well as an https URL. It was https only
   * until definition version 5, which meant the one field a buyer most wants to
   * fill from their phone was the one field the upload capability could not
   * reach. See docs/template-format.md.
   */
  image: contentPicture('Photograph').optional(),
  /**
   * Decorative invitation artwork, drawn as a band across the head of the page
   * above the names. It is what makes the page read as an invitation rather
   * than as a web page about a wedding.
   *
   * It is a second picture field rather than a mode on `image`, because the two
   * are different kinds of thing and the difference is load bearing:
   *
   *   `image`   is CONTENT. It is a photograph of the couple, it means
   *             something, and it therefore carries alt text.
   *   `artwork` is DECORATION. It means nothing that the page does not already
   *             say in words, so it carries no alt text at all and there is
   *             nowhere to put any. The block draws it with `alt=""`.
   *
   * That is why the couple's names, date and venue must never be painted into
   * it. A whole invitation card used here puts every one of them on the page
   * twice: once as pixels in somebody else's typeface, and once as the real,
   * themed, selectable text below. The format cannot enforce that, because it
   * cannot read a JPEG, and the guided form will have to. What it can do is
   * refuse to offer an alt field, so nobody is ever asked to transcribe the
   * words baked into a picture.
   *
   * There is no frame or variant key yet. The design directions report
   * specifies one, the stepped arch aperture that is Foil & Midnight's
   * signature, and it is not built here. It arrives as a new OPTIONAL field,
   * which by the rules in docs/template-format.md is a version bump with no
   * rewrite.
   */
  artwork: decorativePicture('Invitation artwork').optional(),
})

export type HeroConfig = z.infer<typeof heroConfigSchema>

// details -------------------------------------------------------------------

/**
 * A closed set. An icon name is a key into a bundled sprite, so an open string
 * would be either a broken icon or a way to load a remote asset onto a guest
 * page.
 */
export const DETAIL_ICONS = [
  'calendar',
  'clock',
  'pin',
  'dress-code',
  'gift',
  'parking',
  'info',
] as const

/**
 * Where an item's value comes from when it is not literal text.
 *
 * This is a closed enum and not an expression language on purpose. "Just let a
 * template write {{event.date}}" is how a buyer editable document turns into a
 * sandbox, and it is also how the same date ends up formatted three different
 * ways on one page. A source names a field on the event row and the renderer
 * formats it once, in the event's own time zone.
 */
export const DETAIL_SOURCES = ['event-date', 'event-start-time', 'event-end-time'] as const

export const detailsItemSchema = z
  .strictObject({
    icon: z.enum(DETAIL_ICONS).optional().describe('Icon'),
    label: text(40, 'Label'),
    /** Literal text. Exactly one of value or source is present. */
    value: optionalText(240, 'What it says'),
    /** Reads the value off the event row instead of storing a second copy of it. */
    source: z.enum(DETAIL_SOURCES).optional().describe('Or read it off the event'),
  })
  .superRefine((item, ctx) => {
    const supplied = [item.value !== undefined, item.source !== undefined].filter(Boolean).length
    if (supplied !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'provide exactly one of value or source',
      })
    }
  })

export const detailsConfigSchema = z.strictObject({
  heading: optionalText(80, 'Heading'),
  items: z.array(detailsItemSchema).min(1).max(8).describe('The list'),
})

export type DetailsConfig = z.infer<typeof detailsConfigSchema>

// countdown -----------------------------------------------------------------

export const COUNTDOWN_UNITS = ['days', 'hours', 'minutes', 'seconds'] as const

/**
 * There is no target date in this config, and that is the point. The countdown
 * resolves against `events.starts_at_local` and `events.time_zone`, so a DST
 * boundary is handled in one place instead of once per template.
 */
export const countdownConfigSchema = z.strictObject({
  heading: optionalText(80, 'Heading'),
  units: z
    .array(z.enum(COUNTDOWN_UNITS))
    .min(1)
    .max(COUNTDOWN_UNITS.length)
    .refine((units) => new Set(units).size === units.length, 'units must not repeat')
    .describe('Count in'),
  /** Shown once the event has started. A countdown with nothing to say is a bug guests see. */
  passedMessage: text(120, 'Once the day arrives'),
})

export type CountdownConfig = z.infer<typeof countdownConfigSchema>

// map -----------------------------------------------------------------------

export const mapConfigSchema = z.strictObject({
  heading: optionalText(80, 'Heading'),
  venueName: text(120, 'Venue'),
  /** Free text, newlines allowed, because addresses are not uniform across countries. */
  address: text(240, 'Address'),
  /** A link out to a maps app. No embedded provider or key here: that is deployment config. */
  directionsUrl: httpsUrlSchema.optional().describe('Link to directions'),
  coordinates: z
    .strictObject({
      lat: z.number().min(-90).max(90).describe('Latitude'),
      lng: z.number().min(-180).max(180).describe('Longitude'),
    })
    .optional()
    .describe('Coordinates'),
  note: optionalText(200, 'Note'),
})

export type MapConfig = z.infer<typeof mapConfigSchema>

// rsvp-form -----------------------------------------------------------------

/**
 * This config carries the form's words and its one envelope control. It does
 * not carry the questions, and that is the shape of the whole reply path.
 *
 * A reply is an envelope plus answers. Attendance and party size are envelope
 * columns on `rsvps`, because neither is ever optional and because the
 * headcount query must not depend on which questions an event happens to ask.
 * Everything a guest writes is a row in `rsvp_questions` answered into
 * `rsvp_answers`, which is what lets a sixth question type be an addition
 * rather than a migration (`docs/replies.md`).
 *
 * So the questions are not here, and the format is better for it in two ways.
 * There is one answer to "what does this event ask", the rows, rather than a
 * document and a table that can disagree. And a stored document cannot
 * introduce a question, so it cannot introduce guest personal information that
 * nobody classified: every question carries a `pii_class` and that column is
 * what the retention sweep reads.
 *
 * `guestCount` stays because party size is the envelope, not a question. The
 * `max` here is the ceiling the buyer offers, and the write path reads it from
 * this document rather than from the submitted form.
 */
export const rsvpFormConfigSchema = z.strictObject({
  heading: optionalText(80, 'Heading'),
  intro: optionalText(300, 'Introduction'),
  submitLabel: text(40, 'Button'),
  successMessage: text(200, 'Thank you message'),
  /** Shown during the grace period, when the page still serves but RSVPs are closed. */
  closedMessage: text(200, 'Message once replies are closed'),
  deadlineNote: optionalText(160, 'Reply-by note'),
  guestCount: z
    .strictObject({
      enabled: z.boolean().describe('Ask how many are coming'),
      label: optionalText(60, 'Label'),
      max: z.number().int().min(1).max(20).describe('Most a guest may bring'),
    })
    .describe('Party size'),
})

export type RsvpFormConfig = z.infer<typeof rsvpFormConfigSchema>

// registry ------------------------------------------------------------------

/**
 * The one map from block type to schema. Everything else in the format reads
 * types out of this object, so adding a key here is what "adding a block" means.
 */
export const BLOCK_CONFIG_SCHEMAS = {
  hero: heroConfigSchema,
  details: detailsConfigSchema,
  countdown: countdownConfigSchema,
  map: mapConfigSchema,
  'rsvp-form': rsvpFormConfigSchema,
} as const

export type BlockType = keyof typeof BLOCK_CONFIG_SCHEMAS

export const BLOCK_TYPES = Object.keys(BLOCK_CONFIG_SCHEMAS) as BlockType[]

/**
 * Registry metadata, separate from the schemas because it answers a different
 * question: not "is this document valid" but "may a new template use this".
 *
 * A retired block keeps its schema forever, so documents written against it
 * still validate. `status` is what stops it being offered again. That is the
 * whole removal mechanism: retire, then migrate, and only delete the schema
 * once no stored document references the type.
 */
export type BlockRegistryEntry = {
  readonly type: BlockType
  readonly label: string
  readonly status: 'active' | 'retired'
  /** Definition format version this block type first appeared in. */
  readonly addedIn: number
  /** Set when status is 'retired'. */
  readonly retiredIn?: number
  /** Where a retired block's content went, for the human reading this later. */
  readonly supersededBy?: BlockType
}

export const BLOCK_REGISTRY: Readonly<Record<BlockType, BlockRegistryEntry>> = {
  hero: { type: 'hero', label: 'Hero', status: 'active', addedIn: 1 },
  details: { type: 'details', label: 'Details', status: 'active', addedIn: 1 },
  countdown: { type: 'countdown', label: 'Countdown', status: 'active', addedIn: 1 },
  map: { type: 'map', label: 'Map', status: 'active', addedIn: 1 },
  'rsvp-form': { type: 'rsvp-form', label: 'RSVP form', status: 'active', addedIn: 1 },
}

export function isBlockType(value: string): value is BlockType {
  return Object.hasOwn(BLOCK_CONFIG_SCHEMAS, value)
}

/** True when a block type may be used in a template being authored now. */
export function isAuthorable(type: BlockType): boolean {
  return BLOCK_REGISTRY[type].status === 'active'
}
