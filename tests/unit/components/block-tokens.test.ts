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
import { findStyleViolations } from './token-guard'

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
