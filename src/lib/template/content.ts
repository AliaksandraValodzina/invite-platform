/**
 * The event content document: what a buyer changed, keyed by block id.
 *
 * Stored in `event_content.content`, shape
 * `{ version, blocks: { <id>: {...} }, sections?: [...] }`, which is what the
 * check constraints on that table already assert, plus an optional `envelope`,
 * which is the cover and has no block id to be keyed by.
 *
 * Content holds OVERRIDES, not a copy of the page. A block the buyer never
 * touched has no entry here at all, so a fix to a template's default copy
 * reaches every event that did not override it. The alternative, snapshotting
 * the whole page at activation, means a typo in a template is permanent for
 * everyone who bought it before we noticed.
 *
 * An override is a shallow, strict partial of the block config, and merging is a
 * top level key replace. A nested object such as `hero.image` or
 * `rsvp-form.fields` is supplied whole or not at all. That is a deliberate
 * refusal to write a deep merge: deep merging arrays and optional keys has a
 * dozen defensible answers, and the wrong one silently produces a page nobody
 * asked for. The merged result is validated against the full block schema, so a
 * half supplied nested object fails immediately and loudly.
 *
 * `sections` is the same idea one level up: composition as an override. It is
 * the buyer's own section list, and it is ABSENT until they change one, so a
 * template that gains a section still reaches every event that never touched
 * its composition. See ./composition.ts.
 *
 * This document cannot be fully validated on its own. It does not know which
 * block types its ids point at, nor whether the ids in `sections` name blocks
 * that exist; only the definition knows that. Structure is checked here, and the
 * per block check happens in resolve.ts where both documents are in hand.
 */

import { z } from 'zod'

import { createDocumentPipeline, type DocumentMigration } from './document'
import { slugSchema } from './primitives'

export const CURRENT_CONTENT_VERSION = 3

export const CONTENT_MIGRATIONS: readonly DocumentMigration[] = [
  {
    from: 1,
    to: 2,
    description: 'content gains an envelope override, beside the block overrides',
    /*
     * Nothing to rewrite. `envelope` is optional, so a version 1 document
     * validates against the version 2 schema exactly as it was stored, and an
     * event that never touched its envelope renders the template's one.
     *
     * The number moves for the same reason it moves on a definition: the shape
     * of the document changed, `event_content.content_version` mirrors it, and
     * a change nothing downstream can see is a change nobody can find later.
     */
    migrate: (document) => ({ ...document, version: 2 }),
  },
  {
    from: 2,
    to: 3,
    description: 'content gains a section list, so composition belongs to the buyer',
    /*
     * Nothing to rewrite, and the absence is the whole design.
     *
     * `sections` is optional, and ABSENT means "the template's block list, in
     * the template's order". So a version 2 document validates against the
     * version 3 schema exactly as it was stored, and every event written before
     * this renders the day after exactly as it did the day before.
     *
     * Writing the template's own order in here as part of the migration would
     * have been the expensive mistake: it would freeze every existing event's
     * composition at whatever its template said today, and a template that
     * later gained a section would never reach any of them. Composition is an
     * override for the same reason the words are.
     *
     * The number still moves, because a version 3 document may contain a key
     * version 2 code would reject as unknown (the schema is strict), and
     * `event_content.content_version` is what tells a rollback it is looking at
     * a document it does not understand.
     */
    migrate: (document) => ({ ...document, version: 3 }),
  },
]

const overrideRecordSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => !Array.isArray(value), 'must be an object of field overrides')

/**
 * The buyer's own section list: block ids, in the order the page draws them.
 *
 * Ids and nothing else, which is the narrowest shape that can say "which
 * sections, in what order". It carries no `type` and no `config`, because both
 * of those belong to the template block the id names: an id selects the block,
 * the block's `type` selects the schema, and the buyer's words are still keyed
 * by the id in `blocks`. A list that repeated `type` here would be a second
 * answer to "what kind of section is this", and the two would disagree the day
 * a template renamed one.
 *
 * The floor is one, matching the definition's own: a page with no sections is
 * not a page, and an empty list would reach the resolver as "serve nothing".
 * The ceiling matches too, for the reason it exists there: a phone on bad wifi.
 *
 * What this shape deliberately cannot express is a section the template does
 * not contain. That is the design catalogue, which is gated on an open decision
 * about authoring capacity, and widening this to name one is a version bump and
 * a migration, which is exactly what this format is built for.
 */
export const eventSectionsSchema = z
  .array(slugSchema)
  .min(1)
  .max(24)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'must not name the same section twice: content is keyed by block id, so two entries would draw one section twice from one set of words'
  )

export const eventContentSchema = z.strictObject({
  version: z.number().int().positive(),
  blocks: z.record(slugSchema, overrideRecordSchema),
  /**
   * Which sections this invitation has, in what order.
   *
   * Absent means the template's block list exactly, which is what every event
   * carries until its buyer moves something. See `eventSectionsSchema`.
   */
  sections: eventSectionsSchema.optional(),
  /**
   * The buyer's overrides for the cover, merged the same way a block's are:
   * top level key replace, with `null` clearing a field.
   *
   * It is a sibling of `blocks` and not a key inside it because the envelope is
   * not a block and has no block id to be keyed by. This is also where a buyer
   * supplied envelope picture lands, as `{ "envelope": { "image": ... } }`,
   * built from an `envelope` kind upload by `pictureFromUpload` in
   * src/lib/uploads/picture.ts. See docs/envelope.md.
   */
  envelope: overrideRecordSchema.optional(),
})

export type EventContent = z.infer<typeof eventContentSchema>

export const eventContentPipeline = createDocumentPipeline<EventContent>({
  name: 'event content',
  version: CURRENT_CONTENT_VERSION,
  schema: eventContentSchema,
  migrations: CONTENT_MIGRATIONS,
})

/** What a freshly activated event stores before the buyer has changed anything. */
export const EMPTY_EVENT_CONTENT: EventContent = { version: CURRENT_CONTENT_VERSION, blocks: {} }
