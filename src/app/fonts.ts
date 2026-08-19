/**
 * The faces the three design directions ask for, self hosted.
 *
 * Three rules from the font payload finding in
 * data/ip-design-directions/report.md, and how each one is kept:
 *
 * "each direction loads at most three faces: display 400, body 400, body 600".
 * Every entry below names its weights explicitly rather than pulling a family,
 * so the set is countable. Deckle needs EB Garamond 400 with Karla 400 and 600,
 * Masthead needs Bodoni Moda 400 with Archivo 400 and 600, and Foil needs
 * Cinzel 400 with Jost 400 only, because the report found Jost 300 too thin to
 * hold at 13px on a low DPI LCD. `tests/unit/template/fonts.test.ts` counts them
 * against the themes.
 *
 * "three directions must not mean loading three full webfont families on every
 * page". `preload: false` is what buys that. Next would otherwise emit a
 * `<link rel="preload">` for every face in a route's import graph, and the guest
 * page is one dynamic route serving every template, so every guest would fetch
 * all six. Without the preload hint a browser fetches a font file only when it
 * has a glyph to draw in it, so a guest opening a Masthead invitation downloads
 * Bodoni Moda and Archivo and nothing else. What all six do cost is their
 * `@font-face` rules, which is text in the route stylesheet rather than font
 * payload.
 *
 * "Self-host through `next/font` with `display: swap` rather than linking
 * Google's stylesheet, so the fonts are same-origin and there is no third-party
 * round trip on a cold connection." That is what `next/font/google` does: the
 * files are fetched at build time and served from this origin.
 *
 * The two placeholder themes committed with the template format, ivory and
 * midnight, are deliberately not here. They are not part of the template line,
 * and they keep falling back to Georgia and system-ui as they always have.
 */

import { Archivo, Bodoni_Moda, Cinzel, EB_Garamond, Jost, Karla } from 'next/font/google'

import { primaryFamily, type ThemeTokens } from '@/lib/template'

/*
 * The options are repeated per call rather than spread from a shared object,
 * because `next/font/google` types each family's subsets and weights against
 * what that family actually publishes, and a shared literal cannot satisfy six
 * different unions at once.
 */
const ebGaramond = EB_Garamond({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  weight: ['400'],
})
const karla = Karla({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400', '600'] })
const bodoniModa = Bodoni_Moda({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  weight: ['400'],
})
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  weight: ['400', '600'],
})
const cinzel = Cinzel({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400'] })
const jost = Jost({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400'] })

/**
 * Keyed by the family name a theme document writes.
 *
 * A theme carries a font stack, not a font file, and it names real families:
 * `'EB Garamond', 'Iowan Old Style', 'Times New Roman', serif`. `next/font`
 * hashes the family name it generates, so the two cannot meet unless something
 * maps one onto the other, and this is that map. Keeping the real name in the
 * document is what lets a theme stay readable, stay portable, and keep working
 * on its fallbacks when a face is not self hosted.
 */
const SELF_HOSTED: Readonly<Record<string, string>> = {
  'EB Garamond': ebGaramond.style.fontFamily,
  Karla: karla.style.fontFamily,
  'Bodoni Moda': bodoniModa.style.fontFamily,
  Archivo: archivo.style.fontFamily,
  Cinzel: cinzel.style.fontFamily,
  Jost: jost.style.fontFamily,
}

export const SELF_HOSTED_FAMILIES = Object.keys(SELF_HOSTED)

/**
 * Swaps the head of a stack for the self hosted face of the same name, leaving
 * the rest of the stack alone as the fallback chain it already is.
 *
 * Only the first family is considered. A theme's first entry is its choice and
 * everything after it is what to do when that choice is unavailable, so
 * substituting further down would quietly promote a fallback.
 */
export function withSelfHostedFonts(stack: string): string {
  const family = primaryFamily(stack)
  const hosted = SELF_HOSTED[family]
  if (hosted === undefined) return stack

  const rest = stack.slice(stack.indexOf(family) + family.length).replace(/^['"]?\s*,?\s*/, '')
  return rest.length === 0 ? hosted : `${hosted}, ${rest}`
}

/**
 * The seam between a theme document and the self hosted faces.
 *
 * It is applied by the route rather than inside `ThemeScope`, so that the
 * component that turns tokens into CSS stays free of anything Next specific and
 * can be rendered in a unit test. The guest page in Phase 0.5 calls this the
 * same way the preview route does.
 */
export function withWebFonts(tokens: ThemeTokens): ThemeTokens {
  return {
    ...tokens,
    font: {
      heading: withSelfHostedFonts(tokens.font.heading),
      body: withSelfHostedFonts(tokens.font.body),
    },
  }
}
