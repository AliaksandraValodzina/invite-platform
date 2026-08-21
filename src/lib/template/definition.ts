/**
 * The template definition document: which blocks, in what order, with the
 * default content a buyer starts from.
 *
 * Stored in `templates.definition`, mirrored by `templates.definition_version`.
 * Shape is `{ version, blocks: [...] }`, which is exactly what the check
 * constraints on that table already assert, plus an optional `envelope`: the
 * cover a guest opens, which sits beside the block list rather than inside it
 * because it is drawn over the page instead of being a section of it. See
 * `./envelope.ts`.
 *
 * Two identifiers, doing two different jobs, and keeping them separate is what
 * makes a rename survivable:
 *
 *   `id`    identity of a block INSTANCE. Event content is keyed by it, so an id
 *           is permanent and is never reused for a different block.
 *   `type`  identity of a block KIND. It selects the config schema and, later,
 *           the component. Renaming a type is a migration that rewrites this
 *           field and touches no ids, so no buyer content moves.
 */

import { z } from 'zod'

import { BLOCK_CONFIG_SCHEMAS, type BlockType } from './blocks'
import { createDocumentPipeline, type DocumentMigration } from './document'
import { envelopeConfigSchema, type EnvelopeConfig } from './envelope'
import { slugSchema } from './primitives'

/** Bumped when the shape of a block config, or the block list itself, changes. */
export const CURRENT_DEFINITION_VERSION = 5

/**
 * The ladder. The runner asserts this list has exactly
 * `CURRENT_DEFINITION_VERSION - 1` entries, so bumping the version without
 * writing the migration fails at import time.
 */
export const DEFINITION_MIGRATIONS: readonly DocumentMigration[] = [
  {
    from: 1,
    to: 2,
    description: 'hero gains an optional artwork slot',
    /*
     * Nothing to rewrite. `hero.artwork` is optional, so a version 1 document
     * satisfies the version 2 schema exactly as it was stored, and a version 1
     * hero renders the way it did the day before: with no artwork.
     *
     * The number still moves. `CURRENT_DEFINITION_VERSION` is what a write path
     * checks with `{ migrate: false }`, and it is what makes
     * `templates.definition_version` answer "which documents predate the
     * artwork slot" with a query rather than with a guess. A block config shape
     * that changed without the number moving is a change nothing downstream can
     * see. See docs/template-format.md.
     */
    migrate: (document) => ({ ...document, version: 2 }),
  },
  {
    from: 2,
    to: 3,
    description: 'rsvp-form stops declaring questions, because questions are rows now',
    /*
     * The reply path moved to `rsvp_questions` and `rsvp_answers`
     * (20260821010000). What a guest is asked is a row carrying a `pii_class`,
     * so the document no longer carries `fields`, and the one part of it that
     * was never a question keeps its meaning: party size is an envelope column
     * on `rsvps`, so `guestCount` moves up a level rather than going away.
     *
     * This is a REWRITE and not just a number, because `fields` is required in
     * version 2 and the version 3 schema is strict: a stored document that kept
     * it would stop validating, and a block whose config does not validate is a
     * block the resolver omits. The rule in docs/template-format.md is that a
     * removal costs a migration that reproduces the old rendering, and the old
     * rendering of `fields.email`, `fields.dietary` and `fields.message` is now
     * produced by the default question set in src/lib/rsvp/questions.ts.
     */
    migrate: (document) => ({
      ...document,
      version: 3,
      blocks: asBlockList(document.blocks).map((block) => {
        if (block.type !== 'rsvp-form') return block

        const config = isRecord(block.config) ? block.config : {}
        const { fields, ...rest } = config
        const guestCount = isRecord(fields) ? fields.guestCount : undefined

        return {
          ...block,
          config: {
            ...rest,
            // A version 2 document always had one, because the schema required
            // it. The fallback is what the block set has always offered when a
            // buyer left the ceiling alone, so a document that lost its way
            // still renders a usable form.
            guestCount: guestCount ?? { enabled: true, max: 6 },
          },
        }
      }),
    }),
  },
  {
    from: 3,
    to: 4,
    description: 'the definition gains an optional envelope, the cover a guest opens',
    /*
     * Nothing to rewrite. `envelope` is optional and every field inside it is
     * optional, so a version 3 document satisfies the version 4 schema exactly
     * as it was stored. What it renders is not nothing, though: a document with
     * no envelope key resolves to the universal envelope, which is the point of
     * the feature rather than a gap in it. See src/lib/template/envelope.ts.
     *
     * The number still moves, for the reason the 1 to 2 bump moved it:
     * `templates.definition_version` is what answers "which documents predate
     * the envelope" with a query rather than with a guess.
     */
    migrate: (document) => ({ ...document, version: 4 }),
  },
  {
    from: 4,
    to: 5,
    description: 'every picture in the format is one shape, and may name an upload',
    /*
     * Nothing to rewrite, and the reason is worth stating because it is the
     * cheap half of a change that looks expensive.
     *
     * Version 5 does two things to `hero.image`: it widens `src` from an https
     * URL to the same `imageSourceSchema` `hero.artwork` and the envelope
     * already used, and it adds an optional `widths` list. Both directions are
     * WIDENING, so every version 4 document satisfies the version 5 schema
     * exactly as it was stored, and a hero photo that named an https URL still
     * names one.
     *
     * The number still moves, and here it earns it more than usual. A version 5
     * document may contain `"src": "/a/<key>"` in a field that version 4 code
     * would reject, so `templates.definition_version` is what tells a rollback
     * that it is looking at a document it does not understand, and
     * `load` answers `newer-than-supported` rather than guessing.
     *
     * Why widen at all: the one picture field a buyer most wants to fill from
     * the phone in their hand, the photograph of the two of them, was the one
     * field the upload capability could not reach. See docs/editing.md.
     */
    migrate: (document) => ({ ...document, version: 5 }),
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The block list as a migration sees it: whatever was stored, treated as a list
 * of objects and nothing more.
 *
 * A migration runs BEFORE validation, on a document that has not been checked
 * yet, so it cannot assume the shape it is about to produce. Anything that is
 * not a list of objects is passed through untouched and fails validation
 * afterwards with a message about what is actually wrong, which is a better
 * error than one thrown from inside a migration.
 */
function asBlockList(value: unknown): { type?: unknown; config?: unknown }[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

export type BlockConfigSchemas = Record<string, z.ZodType>

/**
 * Derives the block union from a schema map, so `TemplateBlock` cannot drift
 * from `BLOCK_CONFIG_SCHEMAS`. Adding a key to that map is the only edit needed
 * to add a block type to the format.
 */
export type BlockOf<M extends BlockConfigSchemas> = {
  [K in keyof M & string]: { id: string; type: K; config: z.infer<M[K]> }
}[keyof M & string]

export type DefinitionOf<M extends BlockConfigSchemas> = {
  version: number
  blocks: BlockOf<M>[]
  /**
   * The cover, which is beside the block list rather than in it because it is
   * drawn over the page instead of being a part of it. Absent means the
   * universal envelope, not no envelope.
   */
  envelope?: EnvelopeConfig
}

const blockShellSchema = z.strictObject({
  id: slugSchema,
  type: z.string(),
  config: z.unknown(),
})

const definitionShellSchema = z.strictObject({
  version: z.number().int().positive(),
  /**
   * At least one block, because a template that renders nothing is not a
   * template. The ceiling is a guardrail against a document that would take a
   * phone on bad wifi a long time to render.
   */
  blocks: z.array(blockShellSchema).min(1).max(24),
  /**
   * Validated here rather than in the two pass transform below, because unlike
   * a block config there is no `type` to select a schema by: there is one
   * envelope and one schema for it, so a plain optional key says exactly that.
   */
  envelope: envelopeConfigSchema.optional(),
})

/**
 * Validation runs in two passes on purpose: the block shell first, then the
 * config against the schema its `type` selects. A single discriminated union would say
 * "no branch matched" when a hero headline is too long. This says
 * `blocks.0.config.headline: too big`, which is the difference between a usable
 * error in a guided form and a shrug.
 *
 * Taking the schema map as an argument is not a convenience. It is what lets a
 * test build a genuinely different version of this format, with a block schema
 * that really has changed, and run a stored document through the same code the
 * product runs.
 */
export function createTemplateDefinitionSchema<M extends BlockConfigSchemas>(
  configSchemas: M
): z.ZodType<DefinitionOf<M>> {
  return definitionShellSchema.transform((document, ctx) => {
    const seen = new Set<string>()
    const blocks: { id: string; type: string; config: unknown }[] = []

    document.blocks.forEach((block, index) => {
      if (seen.has(block.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['blocks', index, 'id'],
          message:
            `duplicate block id "${block.id}". Ids are the key event content is stored ` +
            "under, so two blocks sharing one would share a buyer's content.",
        })
      }
      seen.add(block.id)

      const configSchema = Object.hasOwn(configSchemas, block.type)
        ? configSchemas[block.type]
        : undefined

      if (configSchema === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['blocks', index, 'type'],
          message: `unknown block type "${block.type}"`,
        })
        return
      }

      const parsed = configSchema.safeParse(block.config)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['blocks', index, 'config', ...issue.path],
            message: issue.message,
          })
        }
        return
      }

      blocks.push({ id: block.id, type: block.type, config: parsed.data })
    })

    /*
     * `envelope` is spread rather than always written, because no schema in
     * this format uses `.default()`: parsing must never add a key that was not
     * stored. An absent envelope stays absent, and the renderer is what turns
     * that into the universal one.
     */
    return {
      version: document.version,
      blocks,
      ...(document.envelope === undefined ? {} : { envelope: document.envelope }),
    } as DefinitionOf<M>
  })
}

export const templateDefinitionSchema = createTemplateDefinitionSchema(BLOCK_CONFIG_SCHEMAS)

export type TemplateBlock = BlockOf<typeof BLOCK_CONFIG_SCHEMAS>
export type TemplateDefinition = DefinitionOf<typeof BLOCK_CONFIG_SCHEMAS>

export const templateDefinitionPipeline = createDocumentPipeline<TemplateDefinition>({
  name: 'template definition',
  version: CURRENT_DEFINITION_VERSION,
  schema: templateDefinitionSchema,
  migrations: DEFINITION_MIGRATIONS,
})

/**
 * Authoring check, separate from validation.
 *
 * A retired block type still validates, because documents already in the
 * database contain it. What it must not do is appear in something being
 * authored now. Keeping these two questions apart is the whole reason removing
 * a block is survivable.
 */
export function findRetiredBlocks(
  definition: TemplateDefinition,
  registry: Readonly<Record<string, { status: 'active' | 'retired' }>>
): { id: string; type: BlockType }[] {
  return definition.blocks
    .filter((block) => registry[block.type]?.status === 'retired')
    .map((block) => ({ id: block.id, type: block.type }))
}
