/**
 * The event content document: what a buyer changed, keyed by block id.
 *
 * Stored in `event_content.content`, shape `{ version, blocks: { <id>: {...} } }`,
 * which is what the check constraints on that table already assert.
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
 * This document cannot be fully validated on its own. It does not know which
 * block types its ids point at; only the definition knows that. Structure is
 * checked here, and the per block check happens in resolve.ts where both
 * documents are in hand.
 */

import { z } from 'zod'

import { createDocumentPipeline, type DocumentMigration } from './document'
import { slugSchema } from './primitives'

export const CURRENT_CONTENT_VERSION = 1

export const CONTENT_MIGRATIONS: readonly DocumentMigration[] = []

const overrideRecordSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => !Array.isArray(value), 'must be an object of field overrides')

export const eventContentSchema = z.strictObject({
  version: z.number().int().positive(),
  blocks: z.record(slugSchema, overrideRecordSchema),
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
