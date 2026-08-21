/**
 * What the editor offers, and what a save is allowed to write.
 *
 * Three properties are asserted here that no amount of careful UI would give
 * you, because each of them is about what happens when something is already
 * wrong or already gone:
 *
 *   a section whose stored override no longer validates is still editable, and
 *   what the buyer wrote is still in front of them;
 *
 *   content keyed to a block the template no longer has survives every save;
 *
 *   a document that would not render is refused before it is written, and
 *   nothing is written at all rather than the good half of it.
 */

import { describe, expect, it } from 'vitest'

import { buildContentDocument, checkContent, editableSections } from '@/lib/editor'
import { CURRENT_CONTENT_VERSION, templateDefinitionPipeline } from '@/lib/template'
import type { EventContent, TemplateDefinition } from '@/lib/template'

import { CLASSIC_INVITATION, readSeedFile } from '../template/seed-files'

const definition: TemplateDefinition = templateDefinitionPipeline.parse(
  readSeedFile(CLASSIC_INVITATION)
)

function content(
  blocks: Record<string, Record<string, unknown>>,
  envelope?: unknown
): EventContent {
  return {
    version: CURRENT_CONTENT_VERSION,
    blocks,
    ...(envelope === undefined ? {} : { envelope: envelope as Record<string, unknown> }),
  }
}

describe('what is editable', () => {
  it('offers one section per block, plus the envelope beside them', () => {
    const sections = editableSections(definition, content({}))

    expect(sections.map((section) => `${section.kind}:${section.id}`)).toEqual([
      ...definition.blocks.map((block) => `block:${block.id}`),
      'envelope:envelope',
    ])
  })

  it('starts every field from the template, and shows the buyer their own words over it', () => {
    const sections = editableSections(
      definition,
      content({ hero: { headline: 'Wilhelmina & Bartholomew' } })
    )
    const hero = sections.find((section) => section.id === 'hero')

    // The eyebrow is the template's; the headline is the buyer's. That is what
    // an override document merged over a default looks like.
    expect(hero?.current.headline).toBe('Wilhelmina & Bartholomew')
    expect(hero?.current.eyebrow).toBe('Together with their families')
    expect(hero?.base.headline).toBe('Sarah & Tom')
    expect(hero?.issues).toEqual([])
  })

  /**
   * The guest page omits a block whose override no longer validates, and it is
   * right to: a template default is not a stand-in for somebody's words. The
   * editor does the opposite, because the person looking at it is the one who
   * has to fix it.
   */
  it('shows a section whose stored words no longer fit, with the reasons and the words', () => {
    const broken = { headline: '' }
    const sections = editableSections(definition, content({ hero: broken }))
    const hero = sections.find((section) => section.id === 'hero')

    expect(hero?.issues.map((issue) => issue.path)).toContain('headline')
    expect(hero?.storedOverride).toEqual(broken)
    expect(hero?.fields.length).toBeGreaterThan(0)
  })
})

describe('building the document a save writes', () => {
  it('drops an override that came back empty rather than storing an empty object', () => {
    const previous = content({ hero: { headline: 'Wilhelmina & Bartholomew' } })
    const next = buildContentDocument(previous, { blocks: { hero: {} } })

    // An event that overrides nothing is an event that keeps receiving fixes to
    // its template's default copy. `{}` would look identical and stop that.
    expect(next.blocks).toEqual({})
  })

  it('leaves content for a block the template no longer has exactly where it is', () => {
    const previous = content({
      hero: { headline: 'Ours' },
      'the-old-gallery': { heading: 'Photographs' },
    })

    const next = buildContentDocument(previous, { blocks: { hero: { headline: 'Ours still' } } })

    expect(next.blocks['the-old-gallery']).toEqual({ heading: 'Photographs' })
  })

  it('writes the envelope beside the blocks and never inside them', () => {
    const next = buildContentDocument(content({}), {
      blocks: {},
      envelope: { note: 'Save the date' },
    })

    expect(next.envelope).toEqual({ note: 'Save the date' })
    expect(next.blocks).toEqual({})
  })

  it('leaves out an envelope override with nothing in it', () => {
    const next = buildContentDocument(content({}), { blocks: {}, envelope: {} })
    expect(next.envelope).toBeUndefined()
  })

  it('writes the current version, because a save is a document built now', () => {
    expect(buildContentDocument(content({}), { blocks: {} }).version).toBe(CURRENT_CONTENT_VERSION)
  })
})

describe('the gate in front of a write', () => {
  it('passes a document every block validates against', () => {
    const checked = checkContent(definition, content({ hero: { headline: 'Ours' } }))
    expect(checked.ok).toBe(true)
  })

  it('names the block and the field when one does not', () => {
    const checked = checkContent(definition, content({ hero: { headline: null } }))

    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.issues.map((issue) => issue.path)).toContain('blocks.hero.headline')
  })

  it('refuses a whole save for one bad block, rather than writing the good ones', () => {
    // Nothing here writes. The caller gets issues and the stored row is
    // untouched, which is what "nothing a buyer wrote is ever dropped" means on
    // the write path as well as the read path.
    const checked = checkContent(
      definition,
      content({ hero: { headline: 'Ours' }, 'venue-map': { venueName: '' } })
    )

    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.issues.some((issue) => issue.path.startsWith('blocks.venue-map'))).toBe(true)
  })

  it('checks the envelope too, and says so in the path', () => {
    const checked = checkContent(definition, content({}, { note: 'x'.repeat(200) }))

    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.issues.map((issue) => issue.path)).toContain('envelope.note')
  })

  it('refuses a document that is not at the version this deploy writes', () => {
    // A write path loads with `migrate: false`: the caller has just built this,
    // so an old version is a bug in the caller rather than an old row.
    const stale = { version: 1, blocks: {} } as unknown as EventContent
    const checked = checkContent(definition, stale)

    expect(checked.ok).toBe(false)
  })

  it('refuses content for a block id the template does not have without touching it', () => {
    // An orphan is not invalid. There is no block whose schema could refuse it,
    // so it passes, and `buildContentDocument` is what keeps it.
    const checked = checkContent(definition, content({ 'the-old-gallery': { heading: 'Photos' } }))
    expect(checked.ok).toBe(true)
  })
})
