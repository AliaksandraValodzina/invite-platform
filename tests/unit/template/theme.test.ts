import { describe, expect, it } from 'vitest'

import {
  COLOUR_ROLES,
  EMPTY_THEME_OVERRIDE,
  mergeThemeTokens,
  themeOverridePipeline,
  themePipeline,
  themeToCssVariables,
  type ThemeTokens,
} from '@/lib/template'

import { IVORY_THEME, MIDNIGHT_THEME, readSeedFile } from './seed-files'

const ivory: ThemeTokens = themePipeline.parse(readSeedFile(IVORY_THEME)).tokens
const midnight: ThemeTokens = themePipeline.parse(readSeedFile(MIDNIGHT_THEME)).tokens

describe('colour roles', () => {
  it('are named after what they mean, not where they are used', () => {
    // A token called buttonPink cannot be re-themed, because the name has
    // already decided where it is allowed to appear. This asserts the role list
    // itself, so adding a usage named token fails here.
    expect([...COLOUR_ROLES]).toEqual([
      'bg',
      'surface',
      'ink',
      'inkMuted',
      'accent',
      'accentInk',
      'border',
      'critical',
    ])
  })

  it('requires every role, so a block never has a token to fall back from', () => {
    const { critical: _critical, ...missingOne } = ivory.color
    const result = themePipeline.load({ version: 1, tokens: { ...ivory, color: missingOne } })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toContain('tokens.color.critical')
  })
})

describe('token values', () => {
  it.each([
    ['a named colour', 'rebeccapurple'],
    ['a CSS variable', 'var(--brand)'],
    ['a gradient', 'linear-gradient(#fff, #000)'],
  ])('rejects %s, because a token is written into a CSS custom property', (_name, value) => {
    const result = themePipeline.load({
      version: 1,
      tokens: { ...ivory, color: { ...ivory.color, accent: value } },
    })

    expect(result.ok).toBe(false)
  })

  it('rejects a font stack that could smuggle a CSS declaration', () => {
    const result = themePipeline.load({
      version: 1,
      tokens: { ...ivory, font: { ...ivory.font, body: 'Inter; } body { display: none' } },
    })

    expect(result.ok).toBe(false)
  })

  it('rejects an unknown token key rather than ignoring it', () => {
    const result = themePipeline.load({
      version: 1,
      tokens: { ...ivory, shadow: { sm: '0 1px 2px' } },
    })

    expect(result.ok).toBe(false)
  })
})

describe('theme overrides', () => {
  it('accepts the empty override the database defaults to', () => {
    const outcome = themeOverridePipeline.load(EMPTY_THEME_OVERRIDE)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.tokens).toEqual({})
  })

  it('replaces a whole group, which is what picking a palette is', () => {
    const merged = mergeThemeTokens(ivory, { color: midnight.color })

    expect(merged.color).toEqual(midnight.color)
    // Everything else is untouched, so a palette pick cannot change the type scale.
    expect(merged.typeScale).toEqual(ivory.typeScale)
    expect(merged.font).toEqual(ivory.font)
    expect(merged.radius).toEqual(ivory.radius)
  })

  it('rejects a half supplied group, so a merge can never leave a role unset', () => {
    const result = themeOverridePipeline.load({
      version: 1,
      tokens: { color: { accent: '#d4af6a' } },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toContain('tokens.color.bg')
  })
})

describe('themeToCssVariables', () => {
  it('is the only bridge between a token and a stylesheet', () => {
    const variables = themeToCssVariables(ivory)

    expect(variables['--color-bg']).toBe('#fdfbf7')
    expect(variables['--color-ink-muted']).toBe('#6f6a61')
    expect(variables['--font-heading']).toBe("'Cormorant Garamond', Georgia, serif")
    expect(variables['--text-display-size']).toBe('2.5rem')
    expect(variables['--text-display-line']).toBe('1.1')
    expect(variables['--text-display-weight']).toBe('400')
    expect(variables['--text-title-tracking']).toBe('0em')
    expect(variables['--space-md']).toBe('1.25rem')
    expect(variables['--radius-pill']).toBe('999rem')
  })

  it('emits a variable for every token, so no block needs a literal', () => {
    const ivoryVariables = themeToCssVariables(ivory)
    const midnightVariables = themeToCssVariables(midnight)

    // 8 colours + 2 fonts + 4 type roles x 4 + 5 spaces + 4 radii
    expect(Object.keys(ivoryVariables)).toHaveLength(8 + 2 + 16 + 5 + 4)
    // Same names for both themes. If a theme could introduce a variable name,
    // a block would have to know which theme it was rendering under.
    expect(Object.keys(midnightVariables)).toEqual(Object.keys(ivoryVariables))
  })

  it('produces different values for the two committed themes', () => {
    const ivoryVariables = themeToCssVariables(ivory)
    const midnightVariables = themeToCssVariables(midnight)

    expect(ivoryVariables['--color-bg']).not.toBe(midnightVariables['--color-bg'])
    expect(ivoryVariables['--radius-sm']).toBe('0.25rem')
    expect(midnightVariables['--radius-sm']).toBe('0rem')
  })
})
