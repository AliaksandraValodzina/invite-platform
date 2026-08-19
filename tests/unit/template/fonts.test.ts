/**
 * The font payload finding from data/ip-design-directions/report.md, held to.
 *
 * Two sentences from that finding are the whole test. "Each direction loads at
 * most three faces: display 400, body 400, body 600." And "three directions must
 * not mean loading three full webfont families on every page."
 *
 * The count is derived from the theme tokens, and the declarations in
 * `src/app/fonts.ts` are read off disk and held to it. Deriving both from the
 * same place would prove nothing, and `next/font/google` is a build time
 * transform that cannot be imported into a unit test, so the file is read as
 * text the way the block token guard reads the block files.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { primaryFamily, themeFaces, themePipeline } from '@/lib/template'

import {
  ALL_THEMES,
  DECKLE_AND_DEBOSS_THEME,
  DESIGN_DIRECTION_THEMES,
  FOIL_AND_MIDNIGHT_THEME,
  MASTHEAD_THEME,
  readSeedFile,
} from './seed-files'

const FONTS_SOURCE = readFileSync(
  fileURLToPath(new URL('../../../src/app/fonts.ts', import.meta.url)),
  'utf8'
)

type Declaration = {
  readonly family: string
  readonly weights: string[]
  readonly options: string
}

/**
 * `const karla = Karla({ subsets: [...], display: 'swap', preload: false, weight: [...] })`
 *
 * Only the calls are read, never the prose around them, for the same reason the
 * block token guard strips comments: the comments in that file quote the rules
 * they implement, and a reader that counted them would be grading the
 * documentation.
 */
function declaredFaces(): Declaration[] {
  const calls = [...FONTS_SOURCE.matchAll(/^const \w+ = (\w+)\(\{([^)]*)\}\)$/gm)]

  return calls.map((call) => {
    const options = call[2] as string
    const weights = /weight:\s*\[([^\]]*)\]/.exec(options)
    return {
      // next/font names a family by its identifier, underscores for spaces.
      family: (call[1] as string).replace(/_/g, ' '),
      weights: [...(weights?.[1] ?? '').matchAll(/'(\d+)'/g)].map((match) => match[1] as string),
      options,
    }
  })
}

describe('each direction', () => {
  it.each(DESIGN_DIRECTION_THEMES)('%s needs at most three faces', (_name, path) => {
    const faces = themeFaces(themePipeline.parse(readSeedFile(path)).tokens)

    expect(faces.length).toBeLessThanOrEqual(3)
  })

  it('needs exactly the faces the report named', () => {
    const faces = (path: string) =>
      themeFaces(themePipeline.parse(readSeedFile(path)).tokens)
        .map((face) => `${face.family} ${face.weight}`)
        .sort()

    expect(faces(DECKLE_AND_DEBOSS_THEME)).toEqual(['EB Garamond 400', 'Karla 400', 'Karla 600'])
    expect(faces(MASTHEAD_THEME)).toEqual(['Archivo 400', 'Archivo 600', 'Bodoni Moda 400'])
    // Two, not three. The report: Jost 300 is too thin to hold at 13px on a low
    // DPI LCD, so the caption weight in this direction is 400 rather than the
    // 300 it would look best at on a retina screen.
    expect(faces(FOIL_AND_MIDNIGHT_THEME)).toEqual(['Cinzel 400', 'Jost 400'])
  })

  it('sets no type in a weight it does not load', () => {
    const declared = new Map(declaredFaces().map((face) => [face.family, face.weights]))

    for (const [, path] of DESIGN_DIRECTION_THEMES) {
      for (const face of themeFaces(themePipeline.parse(readSeedFile(path)).tokens)) {
        expect(declared.get(face.family)).toContain(String(face.weight))
      }
    }
  })
})

describe('src/app/fonts.ts', () => {
  it('is read by a parser that finds the declarations, not an empty list', () => {
    // Without this, every assertion below would pass by iterating nothing the
    // moment the file was reformatted out from under the regex.
    expect(declaredFaces()).toHaveLength(6)
    for (const declaration of declaredFaces()) {
      expect(declaration.weights.length).toBeGreaterThan(0)
    }
  })

  it('declares the six faces the three directions need, and no others', () => {
    // Not a family more. A seventh declaration is a family every guest pays the
    // @font-face rules for and nobody renders.
    const wanted = new Set(
      DESIGN_DIRECTION_THEMES.flatMap(([, path]) =>
        themeFaces(themePipeline.parse(readSeedFile(path)).tokens).map((face) => face.family)
      )
    )

    expect(
      declaredFaces()
        .map((face) => face.family)
        .sort()
    ).toEqual([...wanted].sort())
  })

  it('loads no weight that no theme sets type in', () => {
    const used = new Set(
      DESIGN_DIRECTION_THEMES.flatMap(([, path]) =>
        themeFaces(themePipeline.parse(readSeedFile(path)).tokens).map(
          (face) => `${face.family} ${face.weight}`
        )
      )
    )

    for (const face of declaredFaces()) {
      for (const weight of face.weights) {
        expect([...used]).toContain(`${face.family} ${weight}`)
      }
    }
  })

  it('preloads none of them, which is what stops six families reaching every guest', () => {
    // The guest page is one dynamic route serving every template, so every face
    // in its import graph would otherwise get a <link rel="preload"> on every
    // page. Without the hint a browser fetches a font file only when it has a
    // glyph to draw in it, so a Masthead invitation costs Bodoni Moda and
    // Archivo and nothing else.
    const declarations = declaredFaces()

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      expect(declaration.options).toContain('preload: false')
    }
  })

  it('self hosts with display swap rather than linking a stylesheet', () => {
    // The report: same-origin, and no third party round trip on a cold
    // connection. next/font/google fetches at build time; a <link> to Google
    // would be a DNS lookup and a TLS handshake before the first glyph.
    expect(FONTS_SOURCE).toContain("from 'next/font/google'")
    for (const declaration of declaredFaces()) {
      expect(declaration.options).toContain("display: 'swap'")
    }
    expect(FONTS_SOURCE).not.toContain('fonts.googleapis.com')
  })

  it('leaves the placeholder themes on their fallbacks', () => {
    // ivory and midnight are not part of the template line, so nothing is
    // downloaded for them. They fall back to Georgia and system-ui as they
    // always have.
    const directionFamilies = new Set(
      DESIGN_DIRECTION_THEMES.flatMap(([, path]) =>
        themeFaces(themePipeline.parse(readSeedFile(path)).tokens).map((face) => face.family)
      )
    )

    for (const [name, path] of ALL_THEMES) {
      if (
        directionFamilies.has(
          primaryFamily(themePipeline.parse(readSeedFile(path)).tokens.font.heading)
        )
      ) {
        continue
      }
      expect(['ivory', 'midnight']).toContain(name)
    }

    for (const key of ['Cormorant Garamond', 'Playfair Display', 'Inter']) {
      expect(declaredFaces().map((face) => face.family)).not.toContain(key)
    }
  })
})
