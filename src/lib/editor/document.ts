/**
 * What the editor edits, and what it writes.
 *
 * Two halves, both pure, both testable without a database.
 *
 * `editableSections` turns a template definition and a buyer's stored content
 * into the list the form is drawn from: one entry per section the invitation
 * has, plus the envelope, each carrying the fields the format declares, the
 * template's default, and the value as it stands. Nothing here knows what a hero
 * is.
 *
 * It follows the buyer's own composition, in their order, and it leaves out a
 * section they removed. A form for a section a guest cannot see would be an
 * invitation to type into a page that is not there. The words behind it are
 * still stored and are still untouched by every save, which is what makes
 * putting the section back cost nothing. See ./composition.ts.
 *
 * `buildContentDocument` turns the overrides a save produced back into a whole
 * content document, and `checkContent` is the gate in front of writing it.
 *
 * ## The section a buyer cannot see is the one they need most
 *
 * A block whose stored override no longer validates is omitted from the guest
 * page (docs/template-format.md), which is the right answer for a guest: a
 * template default is not a stand-in for somebody's words. It is the wrong
 * answer for the person who has to fix it, so the editor does the opposite. It
 * merges the stored override in whether or not the result validates, shows the
 * buyer what they stored, and shows the reasons it was refused. The value is
 * never rewritten and never dropped on the way past, which is this repo's rule
 * for every read path: the stored value comes back verbatim.
 *
 * ## An orphan is not the editor's to tidy
 *
 * Content keyed to a block id the definition no longer contains is left exactly
 * where it is by every save. It is what a removed block leaves behind, it is
 * reported rather than deleted, and an editor that helpfully swept it up would
 * be the one thing standing between a buyer and their words if that block ever
 * came back.
 */

import type { z } from 'zod'

import {
  BLOCK_CONFIG_SCHEMAS,
  BLOCK_REGISTRY,
  CURRENT_CONTENT_VERSION,
  UNIVERSAL_ENVELOPE,
  applyOverride,
  composeSections,
  envelopeConfigSchema,
  eventContentPipeline,
  toIssues,
  type BlockConfigSchemas,
  type DocumentIssue,
  type EventContent,
  type TemplateDefinition,
} from '@/lib/template'

import { readFields, type Field } from './fields'
import { isRecord, type JsonRecord } from './values'

/**
 * The key the envelope's override is stored under, which is a sibling of
 * `blocks` and never an id inside it. The cover has no block id to be keyed by.
 */
export const ENVELOPE_SECTION = 'envelope'

export type EditableSection = {
  /**
   * Which document this section's override lives in. It is not decoration: a
   * block's override is keyed by id inside `content.blocks`, and the envelope's
   * sits beside that map. Collapsing the two would be collapsing the one
   * distinction the envelope was built around.
   */
  readonly kind: 'block' | 'envelope'
  /** Block id for a block, and `envelope` for the cover. Content is keyed by it. */
  readonly id: string
  /** Block type for a block, which is what selected the schema. */
  readonly type: string
  readonly label: string
  readonly fields: readonly Field[]
  /** The template's own value, which the override is a diff against. */
  readonly base: JsonRecord
  /** The template's value with the buyer's override merged over it. */
  readonly current: JsonRecord
  /** Why the stored override was refused, if it was. Empty when it is fine. */
  readonly issues: readonly DocumentIssue[]
  /** The stored override, untouched, so nothing a buyer wrote is lost on a read. */
  readonly storedOverride: unknown
}

/**
 * The prefix every input name in one section carries.
 *
 * Kind qualified rather than id qualified, because the envelope has no block id
 * and a block could legitimately be called `envelope`. Two blocks cannot share
 * an id, and `block:envelope` is not the string `envelope`, so nothing collides.
 */
export function sectionPrefix(section: Pick<EditableSection, 'kind' | 'id'>): string {
  return section.kind === 'block' ? `block:${section.id}` : ENVELOPE_SECTION
}

export function editableSections(
  definition: TemplateDefinition,
  content: EventContent,
  configSchemas: BlockConfigSchemas = BLOCK_CONFIG_SCHEMAS
): readonly EditableSection[] {
  const composed = composeSections(definition.blocks, content.sections)

  const sections: EditableSection[] = composed.blocks.map((block) => {
    const override = Object.hasOwn(content.blocks, block.id) ? content.blocks[block.id] : undefined
    const schema = Object.hasOwn(configSchemas, block.type) ? configSchemas[block.type] : undefined
    const base = isRecord(block.config) ? block.config : {}

    if (schema === undefined) {
      // Unreachable while the definition validated against the same schema map.
      return {
        kind: 'block',
        id: block.id,
        type: block.type,
        label: block.type,
        fields: [],
        base,
        current: merge(base, override),
        issues: [{ path: 'type', message: `unknown block type "${block.type}"` }],
        storedOverride: override,
      }
    }

    return {
      kind: 'block',
      id: block.id,
      type: block.type,
      label: BLOCK_REGISTRY[block.type as keyof typeof BLOCK_REGISTRY]?.label ?? block.type,
      fields: readFields(schema),
      base,
      current: merge(base, override),
      issues: issuesOf(schema, merge(base, override)),
      storedOverride: override,
    }
  })

  const envelopeBase = isRecord(definition.envelope) ? definition.envelope : UNIVERSAL_ENVELOPE
  const envelopeOverride = content.envelope

  sections.push({
    kind: 'envelope',
    id: ENVELOPE_SECTION,
    type: ENVELOPE_SECTION,
    label: 'Envelope',
    fields: readFields(envelopeConfigSchema),
    base: envelopeBase as JsonRecord,
    current: merge(envelopeBase as JsonRecord, envelopeOverride),
    issues: issuesOf(envelopeConfigSchema, merge(envelopeBase as JsonRecord, envelopeOverride)),
    storedOverride: envelopeOverride,
  })

  return sections
}

/**
 * The whole content document a save writes.
 *
 * Built from the previous one rather than from nothing, so three things survive
 * that the form knows nothing about: an override for a block id the definition
 * no longer contains, any block the editor did not offer, and the composition.
 * An override that came back empty is removed rather than stored as `{}`,
 * because a buyer who put every field back the way the template had it has not
 * overridden anything, and an empty object here would be an event that stopped
 * tracking a fix to the template's default copy.
 *
 * The composition is carried across untouched, which is what stops a save of the
 * words from quietly putting a removed section back or resetting an order.
 */
export function buildContentDocument(
  previous: EventContent,
  changes: {
    readonly blocks: Readonly<Record<string, JsonRecord>>
    readonly envelope?: JsonRecord | undefined
  }
): EventContent {
  const blocks: Record<string, JsonRecord> = { ...previous.blocks } as Record<string, JsonRecord>

  for (const [id, override] of Object.entries(changes.blocks)) {
    if (Object.keys(override).length === 0) {
      delete blocks[id]
      continue
    }
    blocks[id] = override
  }

  const envelope = changes.envelope
  const keepEnvelope = envelope !== undefined && Object.keys(envelope).length > 0

  return {
    version: CURRENT_CONTENT_VERSION,
    blocks,
    ...(previous.sections === undefined ? {} : { sections: previous.sections }),
    ...(keepEnvelope ? { envelope } : {}),
  }
}

/**
 * The same content document under a different composition.
 *
 * `undefined` stores no list at all, which is what the template's own order is
 * written as: composition is an override like the words are, so an invitation
 * that ends up back where the template had it stops carrying one and a section
 * the template gains later reaches it.
 *
 * Nothing else moves. `blocks` is copied across whole, including the words
 * behind a section that is being removed, because those words are the buyer's
 * only copy and a removal is not a decision to throw them away.
 */
export function withSections(
  previous: EventContent,
  sections: readonly string[] | undefined
): EventContent {
  const { sections: _replaced, ...rest } = previous

  return {
    ...rest,
    version: CURRENT_CONTENT_VERSION,
    ...(sections === undefined ? {} : { sections: [...sections] }),
  }
}

export type ContentCheck =
  | { readonly ok: true; readonly content: EventContent }
  | { readonly ok: false; readonly issues: readonly DocumentIssue[] }

/**
 * The gate in front of a write, and it is deliberately the same gate the guest
 * page reads through.
 *
 * The document is loaded with `migrate: false`, which is what a write path does
 * everywhere in this repo: the caller has just built this document at the
 * current version, so a stale version is a bug in the caller rather than an old
 * row. Then every block's merged config is parsed against the schema its type
 * selects, because content on its own does not know which types its ids point
 * at and only the definition does.
 *
 * Only the sections this invitation actually has are checked, and that is
 * deliberate rather than an economy. A section the buyer removed is not drawn,
 * so whether its stored words still fit the template says nothing about whether
 * this save can be served; checking it anyway would mean a buyer who took a
 * broken section out could then save nothing at all. It is checked again the
 * moment the section comes back, which is the moment it starts mattering.
 *
 * Issue paths are the ones a form can point at: `blocks.<id>.<field>`.
 */
export function checkContent(
  definition: TemplateDefinition,
  candidate: EventContent,
  configSchemas: BlockConfigSchemas = BLOCK_CONFIG_SCHEMAS
): ContentCheck {
  const structure = eventContentPipeline.load(candidate, { migrate: false })
  if (!structure.ok) return { ok: false, issues: structure.issues }

  const issues: DocumentIssue[] = []

  for (const block of composeSections(definition.blocks, candidate.sections).blocks) {
    const override = Object.hasOwn(candidate.blocks, block.id) ? candidate.blocks[block.id] : {}
    const schema = Object.hasOwn(configSchemas, block.type) ? configSchemas[block.type] : undefined
    if (schema === undefined) continue

    for (const issue of issuesOf(schema, merge(block.config as JsonRecord, override))) {
      issues.push({ path: `blocks.${block.id}.${issue.path}`, message: issue.message })
    }
  }

  const envelopeBase = isRecord(definition.envelope) ? definition.envelope : UNIVERSAL_ENVELOPE
  for (const issue of issuesOf(
    envelopeConfigSchema,
    merge(envelopeBase as JsonRecord, candidate.envelope)
  )) {
    issues.push({ path: `envelope.${issue.path}`, message: issue.message })
  }

  return issues.length === 0 ? { ok: true, content: structure.document } : { ok: false, issues }
}

function merge(base: JsonRecord, override: JsonRecord | undefined): JsonRecord {
  const merged = applyOverride(base, override ?? {})
  return isRecord(merged) ? merged : {}
}

function issuesOf(schema: z.ZodType, value: unknown): readonly DocumentIssue[] {
  const parsed = schema.safeParse(value)
  return parsed.success ? [] : toIssues(parsed.error)
}
