/**
 * Width estimation, so the card can choose a type size before it is rendered.
 *
 * The card is drawn by satori, which wraps text itself but will not resize it.
 * Choosing the size is therefore our job, and choosing it needs a width. There
 * is no font metric available at plan time, so this is an estimate: a table of
 * per character advances as a fraction of the font size, calibrated against a
 * real next/og render of the bundled face.
 *
 * The estimate is deliberately biased high. Overestimating a width wraps a
 * title one step sooner than strictly necessary; underestimating one puts a
 * buyer's names through the edge of the card. The Playwright suite measures a
 * real render and asserts the quiet margin, which is what keeps this table
 * honest, and it is the harness to rerun when a display face is registered.
 */

/** Anything not covered below. Mid range for a Latin lower case letter. */
const DEFAULT_ADVANCE = 0.58

/** Full width scripts occupy roughly one em per character. */
const FULL_WIDTH_ADVANCE = 1

const ADVANCES = new Map<string, number>([
  [' ', 0.26],
  ['i', 0.3],
  ['j', 0.3],
  ['l', 0.3],
  ['t', 0.36],
  ['f', 0.34],
  ['r', 0.4],
  ['m', 0.86],
  ['w', 0.76],
  ['I', 0.3],
  ['J', 0.5],
  ['M', 0.9],
  ['W', 0.92],
  ['&', 0.72],
  ['.', 0.28],
  [',', 0.28],
  [':', 0.28],
  [';', 0.28],
  ['!', 0.28],
  ["'", 0.24],
  ['’', 0.24],
  ['·', 0.36],
  ['…', 0.9],
  ['-', 0.38],
])

function advance(character: string): number {
  const known = ADVANCES.get(character)
  if (known !== undefined) return known

  const code = character.codePointAt(0) ?? 0
  // CJK, Hangul, Kana and full width punctuation.
  if (code >= 0x1100 && code <= 0x30ff) return FULL_WIDTH_ADVANCE
  if (code >= 0x3400 && code <= 0x9fff) return FULL_WIDTH_ADVANCE
  if (code >= 0xac00 && code <= 0xd7af) return FULL_WIDTH_ADVANCE
  if (code >= 0xff00 && code <= 0xff60) return FULL_WIDTH_ADVANCE

  if (character >= 'A' && character <= 'Z') return 0.68
  if (character >= '0' && character <= '9') return 0.6
  if (character >= 'a' && character <= 'z') return 0.55

  return DEFAULT_ADVANCE
}

/** Estimated rendered width of a single line, in px. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let ems = 0
  for (const character of text) ems += advance(character)
  return ems * fontSize
}

function breakWord(word: string, fontSize: number, maxWidth: number): string[] {
  const chunks: string[] = []
  let current = ''

  for (const character of word) {
    const candidate = current + character
    if (current !== '' && estimateTextWidth(candidate, fontSize) > maxWidth) {
      chunks.push(current)
      current = character
      continue
    }
    current = candidate
  }

  if (current !== '') chunks.push(current)
  return chunks.length > 0 ? chunks : ['']
}

/**
 * Greedy word wrap, matching what satori will do closely enough to count lines.
 *
 * A word that cannot fit on a line of its own is broken rather than allowed to
 * overflow, because one unbroken 40 character surname is a real thing a buyer
 * types and a card with a name running off the edge is worse than a hyphenless
 * break.
 */
export function wrapEstimate(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== '')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`

    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate
      continue
    }

    if (current !== '') {
      lines.push(current)
      current = ''
    }

    if (estimateTextWidth(word, fontSize) <= maxWidth) {
      current = word
      continue
    }

    const chunks = breakWord(word, fontSize, maxWidth)
    lines.push(...chunks.slice(0, -1))
    current = chunks[chunks.length - 1] ?? ''
  }

  if (current !== '') lines.push(current)
  return lines.length > 0 ? lines : ['']
}

/**
 * The longest prefix of `text` that still wraps into `maxLines`, with an
 * ellipsis when anything was dropped.
 *
 * Truncating is the deliberate alternative to shrinking. Past the size floor in
 * contract.ts the title stops being readable in a chat bubble, and a title that
 * has lost its last word still reads as an invitation where a title rendered as
 * a grey smear does not.
 */
export function truncateToLines(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number
): string {
  const fits = (candidate: string) => wrapEstimate(candidate, fontSize, maxWidth).length <= maxLines

  if (fits(text)) return text

  const withEllipsis = (length: number) => `${text.slice(0, length).replace(/\s+$/, '')}…`

  // Binary search on the prefix length. Working from the original string rather
  // than from wrapped lines is what keeps the buyer's own spacing intact.
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(withEllipsis(middle))) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return withEllipsis(low)
}
