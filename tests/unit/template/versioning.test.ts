/**
 * The headline claim of this format:
 *
 *   an event written against version N still renders under version N+1 after a
 *   block schema changes.
 *
 * It is tested by actually changing block schemas, not by asserting a number.
 * Each case below builds a real NEXT version of the format, one rung above the
 * current one, with a real migration, and runs the committed seed document
 * through the same pipeline code the product uses.
 *
 * Every case also runs the same document through a next version that bumped the
 * number and forgot to write the migration, and asserts that it FAILS. That is
 * the fails-first evidence: without the migration these tests go red, so they
 * are testing the mechanism rather than describing it.
 *
 * The hypothetical pipelines are built on top of the REAL ladder rather than
 * instead of it, so each case is also a stored document climbing more than one
 * rung. `CLASSIC_INVITATION_V1` is the committed seed as it stood before the
 * hero gained its artwork slot, and it is here so that the oldest shape the
 * format ever had keeps being exercised as the ladder grows.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  BLOCK_CONFIG_SCHEMAS,
  CURRENT_DEFINITION_VERSION,
  DEFINITION_MIGRATIONS,
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
const NEXT_VERSION = CURRENT_DEFINITION_VERSION + 1

const bumpOnly: DocumentMigration = {
  from: CURRENT_DEFINITION_VERSION,
  to: NEXT_VERSION,
  description: 'bumps the version and changes nothing',
  migrate: (document) => ({ ...document, version: NEXT_VERSION }),
}

/**
 * A format one version ahead of the shipped one, carrying the real ladder plus
 * the hypothetical rung on top. Built from the real migrations rather than from
 * a fresh list, so a stored document from any shipped version has to climb all
 * the way up.
 */
function definitionPipelineNext(
  configSchemas: Record<string, z.ZodType>,
  migration: DocumentMigration
) {
  return createDocumentPipeline({
    name: 'template definition',
    version: NEXT_VERSION,
    schema: createTemplateDefinitionSchema(configSchemas),
    migrations: [...DEFINITION_MIGRATIONS, migration],
  })
}

/**
 * The committed seed as it stood at definition version 1, before `hero.artwork`
 * existed. A real stored row from before the change, kept here so the bottom of
 * the ladder is exercised rather than described.
 */
function classicInvitationV1(): JsonObject {
  const document = readSeedFile(CLASSIC_INVITATION) as JsonObject
  return {
    ...document,
    version: 1,
    blocks: blocksOf(document).map((block) => {
      if (block.type !== 'hero') return block
      const { artwork: _artwork, ...config } = block.config
      return { ...block, config }
    }),
  }
}

describe('the shipped ladder', () => {
  it('has a rung for every version below the current one', () => {
    expect(templateDefinitionPipeline.migrations).toHaveLength(CURRENT_DEFINITION_VERSION - 1)
    expect(templateDefinitionPipeline.migrations.map((step) => [step.from, step.to])).toEqual(
      Array.from({ length: CURRENT_DEFINITION_VERSION - 1 }, (_, index) => [index + 1, index + 2])
    )
  })

  it('authors the committed seed at the current version', () => {
    expect((readSeedFile(CLASSIC_INVITATION) as JsonObject).version).toBe(
      CURRENT_DEFINITION_VERSION
    )
  })

  it('reads a version 1 document written before the artwork slot existed', () => {
    const stored = classicInvitationV1()
    const outcome = templateDefinitionPipeline.load(stored)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.storedVersion).toBe(1)
    expect(outcome.migrated).toBe(true)
    expect(outcome.document.version).toBe(CURRENT_DEFINITION_VERSION)

    // The hero renders exactly as it did before the slot existed: with no
    // artwork, because the field is optional and the migration adds nothing.
    const hero = outcome.document.blocks[0]
    expect(hero?.config).toEqual({
      eyebrow: 'Together with their families',
      headline: 'Sarah & Tom',
      subhead: 'are getting married',
    })
  })

  it('refuses that same version 1 document on a write path', () => {
    // A write path hands over a document it just built, so a stale version is a
    // bug in the caller rather than an old row.
    const outcome = templateDefinitionPipeline.load(classicInvitationV1(), { migrate: false })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('stale-version')
  })
})

// ---------------------------------------------------------------------------
// Adding to a block: a new required field
// ---------------------------------------------------------------------------

describe('a block schema gains a required field in the next version', () => {
  const heroV2 = heroConfigSchema.extend({ align: z.enum(['left', 'center']) })
  const schemasV2 = { ...BLOCK_CONFIG_SCHEMAS, hero: heroV2 }

  const heroGainsAlign: DocumentMigration = {
    from: CURRENT_DEFINITION_VERSION,
    to: NEXT_VERSION,
    description: 'hero gains a required align field, set to the old rendering behaviour',
    migrate: (document) => ({
      ...document,
      version: NEXT_VERSION,
      blocks: blocksOf(document).map((block) =>
        block.type === 'hero' ? { ...block, config: { ...block.config, align: 'center' } } : block
      ),
    }),
  }

  it('rejects the stored event when the migration was forgotten', () => {
    const outcome = definitionPipelineNext(schemasV2, bumpOnly).load(
      readSeedFile(CLASSIC_INVITATION)
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('invalid')
    expect(outcome.issues.map((issue) => issue.path)).toContain('blocks.0.config.align')
  })

  it('renders the stored event under the next version, with the buyer content intact', () => {
    const stored = readSeedFile(CLASSIC_INVITATION)
    const outcome = definitionPipelineNext(schemasV2, heroGainsAlign).load(stored)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.storedVersion).toBe(CURRENT_DEFINITION_VERSION)
    expect(outcome.migrated).toBe(true)
    expect(outcome.document.version).toBe(NEXT_VERSION)

    const hero = outcome.document.blocks[0]
    expect(hero?.type).toBe('hero')
    // The new field arrives with a value chosen by the migration.
    expect(hero?.config).toEqual({
      eyebrow: 'Together with their families',
      headline: 'Sarah & Tom',
      subhead: 'are getting married',
      artwork: {
        src: '/samples/unlicensed-placeholder/floral-band-UNLICENSED-PLACEHOLDER.jpg',
      },
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

  it('leaves the stored document alone, so the row is still at its own version', () => {
    const stored = readSeedFile(CLASSIC_INVITATION)
    definitionPipelineNext(schemasV2, heroGainsAlign).load(stored)

    expect(stored).toEqual(readSeedFile(CLASSIC_INVITATION))
    expect((stored as JsonObject).version).toBe(CURRENT_DEFINITION_VERSION)
  })

  it('carries a version 1 row all the way up, two rungs, with the migrated field on it', () => {
    // The claim the ladder exists for: a row written before the artwork slot
    // climbs the real rung and then the new one, and arrives renderable.
    const outcome = definitionPipelineNext(schemasV2, heroGainsAlign).load(classicInvitationV1())

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.storedVersion).toBe(1)
    expect(outcome.document.version).toBe(NEXT_VERSION)
    expect(outcome.document.blocks[0]?.config).toEqual({
      eyebrow: 'Together with their families',
      headline: 'Sarah & Tom',
      subhead: 'are getting married',
      align: 'center',
    })
  })
})

// ---------------------------------------------------------------------------
// Renaming a block type: the harder direction
// ---------------------------------------------------------------------------

describe('a block type is renamed in the next version', () => {
  // `map` becomes `venue`, because the block is about a place and only
  // sometimes draws a map.
  const { map: _map, ...withoutMap } = BLOCK_CONFIG_SCHEMAS
  const schemasV2 = { ...withoutMap, venue: mapConfigSchema }

  const mapBecomesVenue: DocumentMigration = {
    from: CURRENT_DEFINITION_VERSION,
    to: NEXT_VERSION,
    description: 'the map block type is renamed to venue',
    migrate: (document) => ({
      ...document,
      version: NEXT_VERSION,
      blocks: blocksOf(document).map((block) =>
        block.type === 'map' ? { ...block, type: 'venue' } : block
      ),
    }),
  }

  it('rejects the stored event when the migration was forgotten', () => {
    const outcome = definitionPipelineNext(schemasV2, bumpOnly).load(
      readSeedFile(CLASSIC_INVITATION)
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues).toContainEqual({
      path: 'blocks.3.type',
      message: 'unknown block type "map"',
    })
  })

  it('rewrites the type and does not touch the block id', () => {
    const outcome = definitionPipelineNext(schemasV2, mapBecomesVenue).load(
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
        definition: definitionPipelineNext(schemasV2, mapBecomesVenue),
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

describe('a block is removed from a template in the next version', () => {
  const countdownRemoved: DocumentMigration = {
    from: CURRENT_DEFINITION_VERSION,
    to: NEXT_VERSION,
    description: 'the countdown block is dropped from the block list',
    migrate: (document) => ({
      ...document,
      version: NEXT_VERSION,
      blocks: blocksOf(document).filter((block) => block.type !== 'countdown'),
    }),
  }

  // The schema stays in the map even though no template uses the block any
  // more. A retired type keeps its schema so documents that still contain it
  // continue to validate; the registry is what stops it being offered again.
  const schemasV2 = BLOCK_CONFIG_SCHEMAS

  it('drops the block from the page', () => {
    const outcome = definitionPipelineNext(schemasV2, countdownRemoved).load(
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
        definition: definitionPipelineNext(schemasV2, countdownRemoved),
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
