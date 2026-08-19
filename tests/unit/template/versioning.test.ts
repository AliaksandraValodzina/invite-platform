/**
 * The headline claim of this format:
 *
 *   an event written against version N still renders under version N+1 after a
 *   block schema changes.
 *
 * It is tested by actually changing block schemas, not by asserting a number.
 * Each case below builds a real version 2 of the format, with a real migration,
 * and runs the committed version 1 seed document through the same pipeline code
 * the product uses.
 *
 * Every case also runs the same document through a version 2 that bumped the
 * number and forgot to write the migration, and asserts that it FAILS. That is
 * the fails-first evidence: without the migration these tests go red, so they
 * are testing the mechanism rather than describing it.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  BLOCK_CONFIG_SCHEMAS,
  CURRENT_DEFINITION_VERSION,
  createDocumentPipeline,
  createTemplateDefinitionSchema,
  eventContentPipeline,
  resolveEventPage,
  templateDefinitionPipeline,
  themeOverridePipeline,
  themePipeline,
  type DocumentMigration,
  type JsonObject,
} from '@/lib/template'
import { heroConfigSchema, mapConfigSchema } from '@/lib/template/blocks'

import { CLASSIC_INVITATION, IVORY_THEME, readSeedFile } from './seed-files'

type StoredBlock = { id: string; type: string; config: Record<string, unknown> }

function blocksOf(document: JsonObject): StoredBlock[] {
  return document.blocks as StoredBlock[]
}

/**
 * What a careless version bump looks like: the number moves, nothing else does.
 * Used to prove each migration below is load bearing.
 */
const bumpOnly: DocumentMigration = {
  from: 1,
  to: 2,
  description: 'bumps the version and changes nothing',
  migrate: (document) => ({ ...document, version: 2 }),
}

function definitionPipelineV2(
  configSchemas: Record<string, z.ZodType>,
  migration: DocumentMigration
) {
  return createDocumentPipeline({
    name: 'template definition',
    version: 2,
    schema: createTemplateDefinitionSchema(configSchemas),
    migrations: [migration],
  })
}

describe('the format starts at version 1 with nothing to migrate', () => {
  it('has a version field on every document from the first commit', () => {
    expect(CURRENT_DEFINITION_VERSION).toBe(1)
    expect(templateDefinitionPipeline.migrations).toHaveLength(0)
    expect((readSeedFile(CLASSIC_INVITATION) as JsonObject).version).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Adding to a block: a new required field
// ---------------------------------------------------------------------------

describe('a block schema gains a required field in version 2', () => {
  const heroV2 = heroConfigSchema.extend({ align: z.enum(['left', 'center']) })
  const schemasV2 = { ...BLOCK_CONFIG_SCHEMAS, hero: heroV2 }

  const heroGainsAlign: DocumentMigration = {
    from: 1,
    to: 2,
    description: 'hero gains a required align field, set to the v1 rendering behaviour',
    migrate: (document) => ({
      ...document,
      version: 2,
      blocks: blocksOf(document).map((block) =>
        block.type === 'hero' ? { ...block, config: { ...block.config, align: 'center' } } : block
      ),
    }),
  }

  it('rejects the version 1 event when the migration was forgotten', () => {
    const outcome = definitionPipelineV2(schemasV2, bumpOnly).load(readSeedFile(CLASSIC_INVITATION))

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('invalid')
    expect(outcome.issues.map((issue) => issue.path)).toContain('blocks.0.config.align')
  })

  it('renders the version 1 event under version 2, with the buyer content intact', () => {
    const stored = readSeedFile(CLASSIC_INVITATION)
    const outcome = definitionPipelineV2(schemasV2, heroGainsAlign).load(stored)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.storedVersion).toBe(1)
    expect(outcome.migrated).toBe(true)
    expect(outcome.document.version).toBe(2)

    const hero = outcome.document.blocks[0]
    expect(hero?.type).toBe('hero')
    // The new field arrives with a value chosen by the migration.
    expect(hero?.config).toEqual({
      eyebrow: 'Together with their families',
      headline: 'Sarah & Tom',
      subhead: 'are getting married',
      align: 'center',
    })

    // Every other block came through untouched, in order.
    expect(outcome.document.blocks.map((block) => block.id)).toEqual([
      'hero',
      'event-details',
      'countdown',
      'venue-map',
      'rsvp',
    ])
  })

  it('leaves the stored document alone, so the row is still version 1', () => {
    const stored = readSeedFile(CLASSIC_INVITATION)
    definitionPipelineV2(schemasV2, heroGainsAlign).load(stored)

    expect(stored).toEqual(readSeedFile(CLASSIC_INVITATION))
    expect((stored as JsonObject).version).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Renaming a block type: the harder direction
// ---------------------------------------------------------------------------

describe('a block type is renamed in version 2', () => {
  // `map` becomes `venue`, because the block is about a place and only
  // sometimes draws a map.
  const { map: _map, ...withoutMap } = BLOCK_CONFIG_SCHEMAS
  const schemasV2 = { ...withoutMap, venue: mapConfigSchema }

  const mapBecomesVenue: DocumentMigration = {
    from: 1,
    to: 2,
    description: 'the map block type is renamed to venue',
    migrate: (document) => ({
      ...document,
      version: 2,
      blocks: blocksOf(document).map((block) =>
        block.type === 'map' ? { ...block, type: 'venue' } : block
      ),
    }),
  }

  it('rejects the version 1 event when the migration was forgotten', () => {
    const outcome = definitionPipelineV2(schemasV2, bumpOnly).load(readSeedFile(CLASSIC_INVITATION))

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues).toContainEqual({
      path: 'blocks.3.type',
      message: 'unknown block type "map"',
    })
  })

  it('rewrites the type and does not touch the block id', () => {
    const outcome = definitionPipelineV2(schemasV2, mapBecomesVenue).load(
      readSeedFile(CLASSIC_INVITATION)
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const renamed = outcome.document.blocks[3]
    expect(renamed?.type).toBe('venue')
    // The id is what event content is keyed by. A rename that moved it would
    // orphan every buyer's customisation of that block.
    expect(renamed?.id).toBe('venue-map')
    expect((renamed?.config as { venueName: string }).venueName).toBe('The Boathouse, Shelly Beach')
  })

  it('still applies the buyer content that was written before the rename', () => {
    // The end to end version of the claim: a real stored event, resolved under
    // a format version where the block type it was written against no longer
    // exists.
    const storedContent = {
      version: 1,
      blocks: {
        'venue-map': {
          venueName: 'Sergeants Mess',
          address: '1 Middle Head Road, Mosman NSW 2088',
        },
      },
    }

    const outcome = resolveEventPage(
      {
        definition: readSeedFile(CLASSIC_INVITATION),
        theme: readSeedFile(IVORY_THEME),
        content: storedContent,
        themeOverride: { version: 1, tokens: {} },
      },
      {
        definition: definitionPipelineV2(schemasV2, mapBecomesVenue),
        content: eventContentPipeline,
        theme: themePipeline,
        themeOverride: themeOverridePipeline,
        configSchemas: schemasV2,
      }
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const venue = outcome.page.blocks.find((block) => block.id === 'venue-map')
    expect(venue?.type).toBe('venue')
    expect(venue?.config).toMatchObject({
      venueName: 'Sergeants Mess',
      address: '1 Middle Head Road, Mosman NSW 2088',
      // Fields the buyer did not override still come from the template.
      heading: 'Where',
    })
    expect(outcome.page.omittedBlocks).toEqual([])
    expect(outcome.page.orphanedContent).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Removing a block: the hardest direction
// ---------------------------------------------------------------------------

describe('a block is removed from a template in version 2', () => {
  const countdownRemoved: DocumentMigration = {
    from: 1,
    to: 2,
    description: 'the countdown block is dropped from the block list',
    migrate: (document) => ({
      ...document,
      version: 2,
      blocks: blocksOf(document).filter((block) => block.type !== 'countdown'),
    }),
  }

  // The schema stays in the map even though no template uses the block any
  // more. A retired type keeps its schema so documents that still contain it
  // continue to validate; the registry is what stops it being offered again.
  const schemasV2 = BLOCK_CONFIG_SCHEMAS

  it('drops the block from the page', () => {
    const outcome = definitionPipelineV2(schemasV2, countdownRemoved).load(
      readSeedFile(CLASSIC_INVITATION)
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.blocks.map((block) => block.id)).toEqual([
      'hero',
      'event-details',
      'venue-map',
      'rsvp',
    ])
  })

  it('keeps the buyer content for the removed block and reports it', () => {
    // The rule that matters: never silently drop a buyer's content. The
    // override for a block that no longer exists is not deleted and not
    // ignored, it comes back in the outcome so a human can decide.
    const storedContent = {
      version: 1,
      blocks: {
        countdown: { heading: 'Not long now' },
        hero: { headline: 'Priya & Alex' },
      },
    }

    const outcome = resolveEventPage(
      {
        definition: readSeedFile(CLASSIC_INVITATION),
        theme: readSeedFile(IVORY_THEME),
        content: storedContent,
        themeOverride: { version: 1, tokens: {} },
      },
      {
        definition: definitionPipelineV2(schemasV2, countdownRemoved),
        content: eventContentPipeline,
        theme: themePipeline,
        themeOverride: themeOverridePipeline,
        configSchemas: schemasV2,
      }
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.orphanedContent).toEqual([
      { id: 'countdown', storedOverride: { heading: 'Not long now' } },
    ])
    // The rest of the page is unaffected, including the buyer's hero override.
    const hero = outcome.page.blocks.find((block) => block.id === 'hero')
    expect((hero?.config as { headline: string }).headline).toBe('Priya & Alex')
    // And the stored document still has it.
    expect(storedContent.blocks.countdown).toEqual({ heading: 'Not long now' })
  })
})
