/**
 * The template definition document: which blocks, in what order, with the
 * default content a buyer starts from.
 *
 * Stored in `templates.definition`, mirrored by `templates.definition_version`.
 * Shape is `{ version, blocks: [...] }`, which is exactly what the check
 * constraints on that table already assert.
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
import { slugSchema } from './primitives'

/** Bumped when the shape of a block config, or the block list itself, changes. */
export const CURRENT_DEFINITION_VERSION = 3

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
}

const blockEnvelopeSchema = z.strictObject({
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
  blocks: z.array(blockEnvelopeSchema).min(1).max(24),
})

/**
 * Validation runs in two passes on purpose: the envelope first, then the config
 * against the schema its `type` selects. A single discriminated union would say
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

    return { version: document.version, blocks } as DefinitionOf<M>
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
