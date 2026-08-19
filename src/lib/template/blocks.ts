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

import { httpsUrlSchema, optionalText, text } from './primitives'

// hero ----------------------------------------------------------------------

export const heroConfigSchema = z.strictObject({
  eyebrow: optionalText(60),
  headline: text(120),
  subhead: optionalText(200),
  /** alt is required whenever an image is present. It is content, not polish. */
  image: z.strictObject({ src: httpsUrlSchema, alt: text(160) }).optional(),
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
    icon: z.enum(DETAIL_ICONS).optional(),
    label: text(40),
    /** Literal text. Exactly one of value or source is present. */
    value: optionalText(240),
    /** Reads the value off the event row instead of storing a second copy of it. */
    source: z.enum(DETAIL_SOURCES).optional(),
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
  heading: optionalText(80),
  items: z.array(detailsItemSchema).min(1).max(8),
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
  heading: optionalText(80),
  units: z
    .array(z.enum(COUNTDOWN_UNITS))
    .min(1)
    .max(COUNTDOWN_UNITS.length)
    .refine((units) => new Set(units).size === units.length, 'units must not repeat'),
  /** Shown once the event has started. A countdown with nothing to say is a bug guests see. */
  passedMessage: text(120),
})

export type CountdownConfig = z.infer<typeof countdownConfigSchema>

// map -----------------------------------------------------------------------

export const mapConfigSchema = z.strictObject({
  heading: optionalText(80),
  venueName: text(120),
  /** Free text, newlines allowed, because addresses are not uniform across countries. */
  address: text(240),
  /** A link out to a maps app. No embedded provider or key here: that is deployment config. */
  directionsUrl: httpsUrlSchema.optional(),
  coordinates: z
    .strictObject({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  note: optionalText(200),
})

export type MapConfig = z.infer<typeof mapConfigSchema>

// rsvp-form -----------------------------------------------------------------

const fieldToggleSchema = z.strictObject({
  enabled: z.boolean(),
  label: optionalText(60),
})

/**
 * `fields` is a record of the four known questions, not a list of questions.
 *
 * A list is a question builder with extra steps, and a custom RSVP question
 * builder is explicitly out of scope for v1. It is also a privacy control: the
 * format cannot introduce an RSVP field, so it cannot introduce guest PII that
 * the retention rules on `rsvps` do not already cover. Attendance is not in the
 * record because it is never optional. An RSVP that does not say yes or no is
 * not an RSVP.
 */
export const rsvpFormConfigSchema = z.strictObject({
  heading: optionalText(80),
  intro: optionalText(300),
  submitLabel: text(40),
  successMessage: text(200),
  /** Shown during the grace period, when the page still serves but RSVPs are closed. */
  closedMessage: text(200),
  deadlineNote: optionalText(160),
  fields: z.strictObject({
    email: fieldToggleSchema,
    guestCount: z.strictObject({
      enabled: z.boolean(),
      label: optionalText(60),
      max: z.number().int().min(1).max(20),
    }),
    dietary: fieldToggleSchema,
    message: fieldToggleSchema,
  }),
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
