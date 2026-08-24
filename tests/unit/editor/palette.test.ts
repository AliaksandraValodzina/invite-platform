/**
 * The buyer's colours.
 *
 * The claim the stage rests on is not in this file, it is in
 * `tests/unit/template/resolve.test.ts`: a stored palette this deploy cannot
 * read degrades to the template's and reports it, rather than taking somebody's
 * invitation off screen. Nothing here tightens that, and the last describe block
 * asserts it stays true with a palette this form could never have produced.
 *
 * What is here is the form's own half. A palette identical to the template's is
 * stored as no override at all, for the reason every other override in this
 * repo works that way. `accentInk` is derived from a choice rather than picked,
 * because the token schema pins it to `bg` or `surface` and a control that
 * offered the rejected value would be a control that offers a refusal. And
 * contrast is computed and reported, never enforced.
 */

import { describe, expect, it } from 'vitest'

import {
  ACCENT_INK_FIELD,
  BUYER_COLOUR_ROLES,
  accentInkChoiceOf,
  colourFieldName,
  contrastFindings,
  contrastWarnings,
  paletteOverride,
  readPalette,
  type PaletteColours,
} from '@/lib/editor'
import {
  COLOUR_ROLES,
  CURRENT_THEME_VERSION,
  resolveEventPage,
  themePipeline,
} from '@/lib/template'

import { CLASSIC_INVITATION, IVORY_THEME, readSeedFile } from '../template/seed-files'

const TEMPLATE: PaletteColours = themePipeline.parse(readSeedFile(IVORY_THEME)).tokens.color

function form(colours: Partial<Record<string, string>>, accentInk: string = 'bg'): FormData {
  const data = new FormData()
  for (const role of BUYER_COLOUR_ROLES) {
    data.set(colourFieldName(role), colours[role] ?? TEMPLATE[role])
  }
  data.set(ACCENT_INK_FIELD, accentInk)
  return data
}

describe('reading a submitted palette', () => {
  it('reads the seven swatches and derives the eighth from the choice', () => {
    const read = readPalette(form({ accent: '#2f6f4f' }, 'surface'))

    expect(read.ok).toBe(true)
    if (!read.ok) return

    expect(read.colours.accent).toBe('#2f6f4f')
    expect(read.colours.accentInk).toBe(TEMPLATE.surface)
    // Every role the format has, not only the ones with a control.
    expect(Object.keys(read.colours).sort()).toEqual([...COLOUR_ROLES].sort())
  })

  it('names the field when a value is not a colour, and writes nothing', () => {
    const read = readPalette(form({ ink: 'rebeccapurple' }))

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.issues[0]?.path).toBe('colour.ink')
  })

  it('refuses alpha, because a ratio against a translucent colour is not computable', () => {
    const read = readPalette(form({ border: '#5b606866' }))

    expect(read.ok).toBe(false)
  })

  it('refuses a form that did not say where a button label is drawn from', () => {
    const data = form({})
    data.delete(ACCENT_INK_FIELD)

    const read = readPalette(data)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.issues[0]?.path).toBe(ACCENT_INK_FIELD)
  })

  it('refuses a made up choice rather than falling back to one', () => {
    const read = readPalette(form({}, 'ink'))

    expect(read.ok).toBe(false)
  })

  it('reports every unreadable field at once, so one save fixes them all', () => {
    const read = readPalette(form({ ink: 'red', bg: 'white' }))

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.issues.map((issue) => issue.path).sort()).toEqual(['colour.bg', 'colour.ink'])
  })
})

describe('which choice a stored palette came from', () => {
  it('reads back as the choice that produced it', () => {
    expect(accentInkChoiceOf({ ...TEMPLATE, accentInk: TEMPLATE.bg })).toBe('bg')
    expect(accentInkChoiceOf({ ...TEMPLATE, accentInk: TEMPLATE.surface })).toBe('surface')
  })
})

describe('the palette as an override', () => {
  it('is no override at all when it matches the template', () => {
    const override = paletteOverride(TEMPLATE, TEMPLATE)

    /*
     * Same rule as the words: an event that has overridden nothing keeps
     * tracking its template, so a palette we later correct reaches it. Storing
     * an identical copy would quietly end that.
     */
    expect(override).toEqual({ version: CURRENT_THEME_VERSION, tokens: {} })
  })

  it('is the whole colour group when one value differs', () => {
    const chosen: PaletteColours = { ...TEMPLATE, accent: '#2f6f4f' }
    const override = paletteOverride(chosen, TEMPLATE)

    // Whole, not a subset. A half merged palette is the shape that produces
    // unreadable text on somebody's wedding page.
    expect(override.tokens.color).toEqual(chosen)
    expect(override.tokens.font).toBeUndefined()
  })
})

describe('contrast', () => {
  it('reports every pair a block can produce, and the template passes them all', () => {
    const findings = contrastFindings(TEMPLATE)

    expect(findings.length).toBeGreaterThan(0)
    expect(contrastWarnings(TEMPLATE)).toEqual([])
    expect(findings.every((finding) => finding.ratio >= finding.required)).toBe(true)
  })

  it('names the pair a guest would struggle with, without refusing it', () => {
    const unreadable: PaletteColours = { ...TEMPLATE, ink: TEMPLATE.bg }
    const warnings = contrastWarnings(unreadable)

    expect(warnings.map((warning) => `${warning.foreground}-on-${warning.background}`)).toContain(
      'ink-on-bg'
    )
    // Still a palette the form will save. Reported, never enforced: the colours
    // are the buyer's, and a product that argued with them over one would be
    // worse than one that tells them what their guests will see.
    expect(readPalette(form({ ink: TEMPLATE.bg })).ok).toBe(true)
  })
})

describe('a stored palette this deploy cannot read', () => {
  /*
   * Not reachable through the form, which is the point of seeding it directly.
   * The guest page has to keep serving whatever is in that column, because the
   * alternative is an invitation that goes dark over a colour.
   */
  it('still renders the invitation, in the template colours, and says so', () => {
    const outcome = resolveEventPage({
      definition: readSeedFile(CLASSIC_INVITATION),
      theme: readSeedFile(IVORY_THEME),
      content: { version: 1, blocks: {} },
      themeOverride: {
        version: CURRENT_THEME_VERSION,
        tokens: { color: { ...TEMPLATE, accent: 'not-a-colour' } },
      },
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.blocks.length).toBeGreaterThan(0)
    expect(outcome.page.tokens.color).toEqual(TEMPLATE)
    expect(outcome.page.themeOverrideRejected).not.toBeNull()
    // Verbatim, so the buyer's choice can be repaired rather than guessed at.
    expect(
      (outcome.page.themeOverrideRejected?.stored as { tokens: { color: PaletteColours } }).tokens
        .color.accent
    ).toBe('not-a-colour')
  })
})
