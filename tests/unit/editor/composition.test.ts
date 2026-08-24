/**
 * The composition half of the editor: one pressed button in, one whole section
 * list out.
 *
 * The claim this file exists for is the one the stage brief asked to be decided
 * rather than assumed: **removing a section keeps its words, and putting it back
 * brings them with it.** It is asserted twice over, once on the document a save
 * would write and once through the editor the buyer would then be looking at,
 * because "the words are still in the row" is worth nothing if the form no
 * longer shows them.
 *
 * The second claim is quieter and just as expensive to get wrong: a composition
 * that ends up back at the template's own order is stored as NO list at all. If
 * it were stored as a list, a template that later gained a section would never
 * reach that event, which is the same failure as an editor that wrote merged
 * configs back instead of overrides.
 */

import { describe, expect, it } from 'vitest'

import {
  applyCompositionCommand,
  buildContentDocument,
  checkContent,
  compositionValue,
  compositionView,
  editableSections,
  parseCompositionCommand,
  withSections,
  type CompositionCommand,
} from '@/lib/editor'
import { CURRENT_CONTENT_VERSION, templateDefinitionPipeline } from '@/lib/template'
import type { EventContent, TemplateDefinition } from '@/lib/template'

import { CLASSIC_INVITATION, readSeedFile } from '../template/seed-files'

const definition: TemplateDefinition = templateDefinitionPipeline.parse(
  readSeedFile(CLASSIC_INVITATION)
)

const TEMPLATE_ORDER = ['hero', 'event-details', 'countdown', 'venue-map', 'rsvp']

function content(document: Partial<EventContent> = {}): EventContent {
  return { version: CURRENT_CONTENT_VERSION, blocks: {}, ...document }
}

/** One press, and the content document it would write. */
function press(previous: EventContent, command: CompositionCommand): EventContent {
  const change = applyCompositionCommand(definition, previous, command)
  expect(change.ok).toBe(true)
  if (!change.ok) throw new Error(change.message)

  return withSections(previous, change.sections)
}

describe('reading a pressed button', () => {
  it('reads the value its own control emits', () => {
    expect(parseCompositionCommand(compositionValue('remove', 'venue-map'))).toEqual({
      kind: 'remove',
      id: 'venue-map',
    })
  })

  it('refuses anything else, because a server action is a POST endpoint', () => {
    expect(parseCompositionCommand(null)).toBeNull()
    expect(parseCompositionCommand('')).toBeNull()
    expect(parseCompositionCommand('sideways:hero')).toBeNull()
    expect(parseCompositionCommand('remove:')).toBeNull()
    expect(parseCompositionCommand(':hero')).toBeNull()
    expect(parseCompositionCommand(42)).toBeNull()
  })
})

describe('what the panel is drawn from', () => {
  it('is the template order, with nothing taken out, for a fresh event', () => {
    const view = compositionView(definition, content())

    expect(view.present.map((row) => row.id)).toEqual(TEMPLATE_ORDER)
    expect(view.removed).toEqual([])
    expect(view.isTemplateOrder).toBe(true)
  })

  it('names sections the way a buyer would, not by block type id', () => {
    const view = compositionView(definition, content())

    expect(view.present.map((row) => row.label)).toEqual([
      'Hero',
      'Details',
      'Countdown',
      'Map',
      'RSVP form',
    ])
  })

  it('says which taken out sections still hold something the buyer wrote', () => {
    const view = compositionView(
      definition,
      content({
        blocks: { 'venue-map': { venueName: 'The Quist Family Orangery' } },
        sections: ['hero', 'rsvp'],
      })
    )

    const removed = Object.fromEntries(view.removed.map((row) => [row.id, row.hasWords]))
    expect(removed['venue-map']).toBe(true)
    expect(removed['countdown']).toBe(false)
  })

  it('reports an id this template no longer has, rather than hiding it', () => {
    const view = compositionView(definition, content({ sections: ['hero', 'gallery'] }))

    expect(view.present.map((row) => row.id)).toEqual(['hero'])
    expect(view.unknown).toEqual(['gallery'])
  })
})

describe('moving a section', () => {
  it('swaps it with its neighbour and stores the whole new order', () => {
    const moved = press(content(), { kind: 'up', id: 'countdown' })

    expect(moved.sections).toEqual(['hero', 'countdown', 'event-details', 'venue-map', 'rsvp'])
  })

  it('says so rather than silently doing nothing at either end', () => {
    expect(applyCompositionCommand(definition, content(), { kind: 'up', id: 'hero' })).toEqual({
      ok: false,
      message: 'That section is already first.',
    })
    expect(applyCompositionCommand(definition, content(), { kind: 'down', id: 'rsvp' })).toEqual({
      ok: false,
      message: 'That section is already last.',
    })
  })

  it('stores no list when a move puts the order back where the template had it', () => {
    const moved = press(content(), { kind: 'down', id: 'hero' })
    expect(moved.sections).toEqual(['event-details', 'hero', 'countdown', 'venue-map', 'rsvp'])

    const back = press(moved, { kind: 'up', id: 'hero' })

    /*
     * Not `['hero', 'event-details', ...]`. Composition is an override, so an
     * invitation that matches its template stops carrying one, and a section the
     * template gains later reaches it. Storing the equivalent list would end
     * that silently, on the first move, exactly the way an editor that wrote
     * merged configs back would end template copy fixes.
     */
    expect(back.sections).toBeUndefined()
  })
})

describe('removing a section, and putting it back', () => {
  const withWords = content({
    blocks: {
      'venue-map': {
        heading: 'Where',
        venueName: 'The Quist Family Orangery',
        address: '14 Orangery Lane\nAshgrove NSW 2000',
      },
    },
  })

  it('takes it off the page', () => {
    const removed = press(withWords, { kind: 'remove', id: 'venue-map' })

    expect(removed.sections).toEqual(['hero', 'event-details', 'countdown', 'rsvp'])
    expect(editableSections(definition, removed).map((section) => section.id)).not.toContain(
      'venue-map'
    )
  })

  it('keeps every word that was in it', () => {
    const removed = press(withWords, { kind: 'remove', id: 'venue-map' })

    expect(removed.blocks['venue-map']).toEqual(withWords.blocks['venue-map'])
  })

  it('brings those words back with it, which is the whole answer to a mis-press', () => {
    const removed = press(withWords, { kind: 'remove', id: 'venue-map' })
    const restored = press(removed, { kind: 'add', id: 'venue-map' })

    expect(restored.sections).toEqual(['hero', 'event-details', 'countdown', 'rsvp', 'venue-map'])

    const map = editableSections(definition, restored).find((section) => section.id === 'venue-map')
    expect(map?.current.venueName).toBe('The Quist Family Orangery')
    expect(map?.current.address).toBe('14 Orangery Lane\nAshgrove NSW 2000')
  })

  it('survives a save of the words in between, which is where a rewrite would show', () => {
    const removed = press(withWords, { kind: 'remove', id: 'venue-map' })

    /*
     * The buyer edits something else while the map is off the page. The save
     * writes only the sections the form offered, and the map was not one of
     * them, so its words have to come through the whole way rather than being
     * treated as a section that was left empty.
     */
    const afterWords = buildContentDocument(removed, {
      blocks: { hero: { headline: 'Perpetua & Cornelius' } },
    })
    expect(afterWords.blocks['venue-map']).toEqual(withWords.blocks['venue-map'])
    expect(afterWords.sections).toEqual(removed.sections)

    const restored = press(afterWords, { kind: 'add', id: 'venue-map' })
    expect(restored.blocks['venue-map']).toEqual(withWords.blocks['venue-map'])
  })

  it('refuses to leave an invitation with no sections at all', () => {
    let document = content()
    for (const id of ['event-details', 'countdown', 'venue-map', 'rsvp']) {
      document = press(document, { kind: 'remove', id })
    }

    expect(document.sections).toEqual(['hero'])
    expect(applyCompositionCommand(definition, document, { kind: 'remove', id: 'hero' })).toEqual({
      ok: false,
      message: 'An invitation needs at least one section. Add another before taking this one out.',
    })
  })

  it('offers nothing to add that this template does not have', () => {
    expect(applyCompositionCommand(definition, content(), { kind: 'add', id: 'gallery' })).toEqual({
      ok: false,
      message: 'This template has no section with that name.',
    })
  })

  it('refuses to add a section that is already there', () => {
    expect(applyCompositionCommand(definition, content(), { kind: 'add', id: 'hero' })).toEqual({
      ok: false,
      message: 'That section is already on the invitation.',
    })
  })
})

describe('the gate in front of a composition write', () => {
  it('passes a composition that only reorders, because nothing about the words moved', () => {
    const moved = press(content(), { kind: 'up', id: 'rsvp' })

    expect(checkContent(definition, moved).ok).toBe(true)
  })

  /*
   * The trap this avoids: a buyer whose stored words for one section no longer
   * fit the template takes that section off the page, and then cannot save
   * anything at all because the gate is still checking a section nobody is
   * being shown. Removing the broken thing has to be a way out.
   */
  it('stops checking a section the invitation no longer has', () => {
    const broken = content({ blocks: { 'venue-map': { venueName: '' } } })
    expect(checkContent(definition, broken).ok).toBe(false)

    const removed = press(broken, { kind: 'remove', id: 'venue-map' })
    expect(checkContent(definition, removed).ok).toBe(true)
  })

  it('checks it again the moment it comes back, which is when it starts mattering', () => {
    const broken = content({ blocks: { 'venue-map': { venueName: '' } } })
    const removed = press(broken, { kind: 'remove', id: 'venue-map' })
    const restored = press(removed, { kind: 'add', id: 'venue-map' })

    expect(checkContent(definition, restored).ok).toBe(false)
  })
})
