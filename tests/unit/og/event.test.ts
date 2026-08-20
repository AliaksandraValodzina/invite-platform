import { describe, expect, it } from 'vitest'

import { ogCardFields, ogCardVersion } from '@/lib/og'
import {
  EMPTY_THEME_OVERRIDE,
  resolveEventPage,
  themePipeline,
  type TemplateBlock,
  type ThemeTokens,
} from '@/lib/template'

import {
  CLASSIC_INVITATION,
  IVORY_THEME,
  MIDNIGHT_THEME,
  readSeedFile,
} from '../template/seed-files'

/**
 * Where the card's words come from now that they no longer come from the URL.
 *
 * The fields are read off the RESOLVED blocks rather than off the template, so
 * a buyer who renamed their venue gets a card with their venue on it. That is
 * the whole difference between this and reading the seed file, and it is the
 * thing asserted below with a real content override.
 */

const EVENT = { title: 'Emma & Jake', startsAtLocal: '2027-03-14T16:00:00' }

function blocksWith(content: unknown): readonly TemplateBlock[] {
  const outcome = resolveEventPage({
    definition: readSeedFile(CLASSIC_INVITATION),
    theme: readSeedFile(IVORY_THEME),
    content,
    themeOverride: EMPTY_THEME_OVERRIDE,
  })

  if (!outcome.ok) throw new Error(`the fixture did not resolve: ${outcome.message}`)
  return outcome.page.blocks
}

function tokensOf(themeFile: string): ThemeTokens {
  const outcome = themePipeline.load(readSeedFile(themeFile))
  if (!outcome.ok) throw new Error(`the ${themeFile} seed theme is invalid`)
  return outcome.document.tokens
}

describe('ogCardFields', () => {
  it('takes the title and the wall clock off the event row', () => {
    const fields = ogCardFields(EVENT, blocksWith({ version: 1, blocks: {} }))

    expect(fields.title).toBe(EVENT.title)
    expect(fields.startsAt).toBe(EVENT.startsAtLocal)
  })

  it('takes the kicker and the venue off the blocks the guest actually sees', () => {
    const fields = ogCardFields(
      EVENT,
      blocksWith({
        version: 1,
        blocks: {
          hero: { eyebrow: 'Together with their families' },
          'venue-map': { venueName: 'The Grounds of Alexandria' },
        },
      })
    )

    expect(fields.kicker).toBe('Together with their families')
    expect(fields.venue).toBe('The Grounds of Alexandria')
  })

  it('leaves the kicker out when the buyer cleared it, rather than falling back to the template', () => {
    // `null` in an override means "clear this field", which is how a buyer
    // deletes a line in the guided form. The card has to honour that: the
    // template's default eyebrow is not the buyer's words.
    const fields = ogCardFields(
      EVENT,
      blocksWith({ version: 1, blocks: { hero: { eyebrow: null } } })
    )

    expect(fields.kicker).toBeUndefined()
  })

  it('leaves the venue out when the template has no map block', () => {
    const fields = ogCardFields(EVENT, [
      { id: 'hero', type: 'hero', config: { headline: 'Emma & Jake' } },
    ])

    expect(fields.venue).toBeUndefined()
  })
})

describe('ogCardVersion', () => {
  const fields = ogCardFields(EVENT, blocksWith({ version: 1, blocks: {} }))
  const ivory = tokensOf(IVORY_THEME)
  const baseline = ogCardVersion(fields, ivory)

  it('is stable for the same card, so a link already in a chat keeps working', () => {
    expect(ogCardVersion(fields, ivory)).toBe(baseline)
  })

  it('changes when anything the card draws changes', () => {
    // This is what makes an immutable cache lifetime safe on a slug based URL.
    // If a buyer can fix a typo without the URL moving, the wrong card stays in
    // every chat app that already fetched it, and there is nothing to purge.
    expect(ogCardVersion({ ...fields, title: 'Emma and Jake' }, ivory)).not.toBe(baseline)
    expect(ogCardVersion({ ...fields, kicker: 'A new kicker' }, ivory)).not.toBe(baseline)
    expect(ogCardVersion({ ...fields, venue: 'Somewhere else' }, ivory)).not.toBe(baseline)
    expect(ogCardVersion({ ...fields, startsAt: '2027-03-15T16:00:00' }, ivory)).not.toBe(baseline)
  })

  it('changes when the palette changes, because the card is drawn in it', () => {
    expect(ogCardVersion(fields, tokensOf(MIDNIGHT_THEME))).not.toBe(baseline)
  })

  it('is short enough to sit in a URL without dominating it', () => {
    expect(baseline).toMatch(/^[0-9a-z]{1,13}$/)
  })
})
