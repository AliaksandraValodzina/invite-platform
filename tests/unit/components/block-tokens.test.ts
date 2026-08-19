/**
 * "A block consumes tokens and nothing else. No hardcoded colour, font, radius
 * or spacing value inside a block, ever."
 *
 * That rule is the reason the token work was done before any block was written,
 * and this is where it stops being a sentence in AGENTS.md and becomes something
 * a pull request can fail on. Two halves, and both are needed:
 *
 *   the detector is shown a source written to break the rule, and has to report
 *   every break in it. Without this half, the guard could be broken and the
 *   suite would stay green forever.
 *
 *   the real block files are read off disk and have to come back clean.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { themePipeline, themeToCssVariables } from '@/lib/template'

import { IVORY_THEME, readSeedFile } from '../template/seed-files'
import { findContrastViolations, findStyleViolations } from './token-guard'

/**
 * The vocabulary a block is allowed to write, taken from the schema rather than
 * listed here, so removing a token role makes every block that still uses it
 * fail rather than silently producing an unset custom property.
 */
const KNOWN_TOKENS = Object.keys(
  themeToCssVariables(themePipeline.parse(readSeedFile(IVORY_THEME)).tokens)
)

const BLOCKS_DIR = fileURLToPath(new URL('../../../src/components/blocks/', import.meta.url))

function blockSources(): { name: string; source: string }[] {
  return readdirSync(BLOCKS_DIR)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => ({ name, source: readFileSync(`${BLOCKS_DIR}${name}`, 'utf8') }))
}

describe('the guard itself', () => {
  it('reports a block that hardcodes what the theme is supposed to decide', () => {
    const violating = `
      export function Bad() {
        return (
          <div className="bg-slate-900 p-4 rounded-lg text-sm font-semibold gap-2">
            <span className="text-[#ff0000] tracking-wide" style={{ margin: '4px' }} />
          </div>
        )
      }
    `

    const found = findStyleViolations(violating, KNOWN_TOKENS).map((violation) => violation.found)

    expect(found).toEqual(
      expect.arrayContaining([
        'bg-slate-900',
        'p-4',
        'rounded-lg',
        'text-sm',
        'font-semibold',
        'gap-2',
        'text-[#ff0000]',
        'tracking-wide',
        '#ff0000',
        'style=',
      ])
    )
  })

  it('reports a var that is not a token, which is how a typo would otherwise pass', () => {
    const violations = findStyleViolations(
      `<div className="p-[var(--space-enormous)]" />`,
      KNOWN_TOKENS
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]?.reason).toContain('--space-enormous')
  })

  it('passes a block that reads tokens, and does not trip over layout or copy', () => {
    const clean = `
      const LABEL = 'Sorry, I can not make it'
      export function Good() {
        return (
          <section className="grid w-full grid-cols-[auto_minmax(0,1fr)] px-[var(--space-md)]">
            <p className="type-caption text-center text-[color:var(--color-ink-muted)]">{LABEL}</p>
            <a className="rounded-[var(--radius-pill)] border border-[color:var(--color-border)]" />
          </section>
        )
      }
    `

    expect(findStyleViolations(clean, KNOWN_TOKENS)).toEqual([])
  })

  it('reads code and not comments, so documentation can talk about 320px and hex', () => {
    const documented = `
      // Tested at 320px. Do not write #ff0000 or p-4 in here.
      /* The old version used bg-slate-900 and 16px of padding. */
      export const nothing = null
    `

    expect(findStyleViolations(documented, KNOWN_TOKENS)).toEqual([])
  })
})

describe('the five v1 blocks', () => {
  const sources = blockSources()

  it('is the file set the guard thinks it is', () => {
    // Without this, a renamed directory would make every check below pass by
    // reading nothing at all.
    expect(sources.map((file) => file.name).sort()).toEqual([
      'block-section.tsx',
      'countdown-block.tsx',
      'details-block.tsx',
      'hero-block.tsx',
      'icons.tsx',
      'index.tsx',
      'map-block.tsx',
      'rsvp-form-block.tsx',
    ])
  })

  it.each(blockSources())('$name writes no colour, font, radius or spacing value', (file) => {
    expect(findStyleViolations(file.source, KNOWN_TOKENS)).toEqual([])
  })

  it('draws its icons in currentColor, so an icon is themed by the text around it', () => {
    const icons = readFileSync(`${BLOCKS_DIR}icons.tsx`, 'utf8')
    const paints = icons.match(/(?:fill|stroke)="([^"]*)"/g) ?? []

    expect(paints.length).toBeGreaterThan(0)
    for (const paint of paints) {
      expect(['fill="none"', 'stroke="currentColor"']).toContain(paint)
    }
  })
})

/**
 * The three pairings the design directions report found failing in all three
 * directions, made unreachable from a block.
 *
 * Half the work is done in the theme schema, which refuses an `accentInk` that
 * is not `bg` or `surface`. This is the other half: it stops a block choosing
 * one of the pairings in the first place. Same two halves as the token rule
 * above, and for the same reason. The detector is shown sources written to break
 * each rule, and then the real block files have to come back clean.
 */
describe('the contrast guard itself', () => {
  it('reports a label drawn in ink on an accent fill', () => {
    const violating = `
      export function Bad() {
        return (
          <button className="bg-[var(--color-accent)] text-[color:var(--color-ink)]">Send</button>
        )
      }
    `

    const violations = findContrastViolations(violating)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.reason).toContain('--color-accent-ink')
  })

  it('reports an accent fill that does not say what colour the text on it is', () => {
    // Not a false alarm: inherited text on an accent fill is whatever the page
    // set, which is ink, which is the 1.81:1 pairing. A fill has to name its own
    // ink.
    const violations = findContrastViolations(`<div className="bg-[var(--color-accent)] p-2" />`)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.found).toBe('bg-[var(--color-accent)]')
  })

  it.each([
    ['an ink fill', `<div className="bg-[var(--color-ink)]" />`, 'no ink fill'],
    ['a muted ink fill', `<div className="bg-[var(--color-ink-muted)]" />`, 'no ink fill'],
    [
      'a boundary drawn in surface',
      `<input className="border-[color:var(--color-surface)]" />`,
      'boundaries read --color-ink-muted',
    ],
    [
      'a boundary drawn in border',
      `<input className="border-[color:var(--color-border)]" />`,
      'boundaries read --color-ink-muted',
    ],
    [
      'a ring drawn in surface',
      `<div className="ring-[color:var(--color-surface)]" />`,
      'boundaries read --color-ink-muted',
    ],
  ])('reports %s', (_name, source, reason) => {
    const violations = findContrastViolations(source)

    expect(violations).toHaveLength(1)
    expect(violations[0]?.reason).toContain(reason)
  })

  it('passes the pairing the block set actually uses', () => {
    const clean = `
      const BUTTON = 'bg-[var(--color-accent)] text-[color:var(--color-accent-ink)] rounded-[var(--radius-pill)]'
      const CONTROL = 'border border-[color:var(--color-ink-muted)] bg-[var(--color-surface)] text-[color:var(--color-ink)]'
      export function Good() {
        return <button className={BUTTON}><span className={CONTROL} /></button>
      }
    `

    expect(findContrastViolations(clean)).toEqual([])
  })

  it('reads code and not comments, so a comment may name the pairing it forbids', () => {
    const documented = `
      // Never write bg-[var(--color-ink)] here, and never text-[color:var(--color-ink)]
      /* on bg-[var(--color-accent)]: it is 1.81:1 in the best of the three directions. */
      export const nothing = null
    `

    expect(findContrastViolations(documented)).toEqual([])
  })
})

describe('the five v1 blocks, against the failing pairings', () => {
  it.each(blockSources())('$name writes none of the three pairings', (file) => {
    expect(findContrastViolations(file.source)).toEqual([])
  })

  it('draws the one accent fill there is, so the rule is not vacuously satisfied', () => {
    // Without this, deleting the RSVP button would make every assertion above
    // pass by having nothing left to check.
    const sources = blockSources()
      .map((file) => file.source)
      .join('\n')

    expect(sources).toContain('bg-[var(--color-accent)]')
    expect(sources).toContain('text-[color:var(--color-accent-ink)]')
    expect(sources).toContain('border-[color:var(--color-ink-muted)]')
  })
})
