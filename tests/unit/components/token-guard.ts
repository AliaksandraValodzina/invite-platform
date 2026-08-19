/**
 * The detector behind the block token rule.
 *
 * It reads a component's source and reports every place a colour, font, radius
 * or spacing value was written down instead of consumed as a token. It is a
 * separate module from its test so that the test can prove it catches things,
 * against sources written to be caught, rather than only proving that the real
 * files are currently clean. A guard that has never been seen to fail is not a
 * guard.
 *
 * What it deliberately does not police: layout. `grid`, `w-full`, `col-start-2`
 * and `min-h-dvh` are structure, not theme values, and the rule in AGENTS.md
 * names four things: colour, font, radius and spacing.
 */

export type StyleViolation = {
  /** The offending class, literal or attribute. */
  readonly found: string
  readonly reason: string
}

/**
 * Utility prefixes that set one of the four policed kinds of value. A class
 * beginning with one of these has to carry a `var(--token)`, or it is a value
 * somebody chose inside a block.
 */
const POLICED_PREFIXES = [
  // colour
  'bg',
  'text',
  'border',
  'fill',
  'stroke',
  'ring',
  'divide',
  'shadow',
  'outline',
  'accent',
  'caret',
  'placeholder',
  'decoration',
  'from',
  'via',
  'to',
  // font
  'font',
  'leading',
  'tracking',
  // radius
  'rounded',
  // spacing, and the icon box, which is spacing by another name
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'ps',
  'pe',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'ms',
  'me',
  'gap',
  'gap-x',
  'gap-y',
  'space-x',
  'space-y',
  'size',
] as const

/** The two policed prefixes that are also complete utilities on their own. */
const POLICED_BARE = new Set(['border', 'rounded'])

/**
 * Classes that share a policed prefix but set a behaviour rather than a value.
 *
 * `border` is the entry worth arguing about. It sets a width, and there is no
 * border width token, so the browser hairline is the only width the block set
 * uses. If a theme ever needs a heavier rule, that is a token, not a class in a
 * block. See docs/blocks.md.
 */
const STRUCTURAL_CLASSES = new Set([
  'text-center',
  'text-left',
  'text-right',
  'text-balance',
  'text-pretty',
  'text-wrap',
  'text-nowrap',
  'border',
])

/** `p-[var(--space-md)]`, `text-[color:var(--color-ink)]`, `size-[var(--text-title-size)]`. */
const TOKEN_VALUE = /\[(?:[a-z]+:)?var\((--[a-z0-9-]+)\)\]$/

const LITERAL_CHECKS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /#[0-9a-fA-F]{3,8}\b/, reason: 'a hex colour belongs in a theme document' },
  {
    pattern: /\b(?:rgba?|hsla?|oklch|lab|color-mix)\(/,
    reason: 'a colour function belongs in a theme document',
  },
  {
    pattern: /\b\d+(?:\.\d+)?(?:px|rem|em|pt|vh|vw|vmin|vmax|ch|ex)\b/,
    reason: 'a CSS length is a spacing, radius or type value, and those are tokens',
  },
  {
    pattern: /\bstyle=/,
    reason: 'ThemeScope is the only place that writes a style attribute',
  },
]

export function findStyleViolations(
  source: string,
  knownTokens: readonly string[]
): StyleViolation[] {
  const code = stripComments(source)
  const tokens = new Set(knownTokens)
  const violations: StyleViolation[] = []

  for (const check of LITERAL_CHECKS) {
    const match = check.pattern.exec(code)
    if (match !== null) violations.push({ found: match[0], reason: check.reason })
  }

  for (const className of classNames(code)) {
    const utility = withoutVariants(className)
    if (STRUCTURAL_CLASSES.has(utility)) continue
    if (!isPoliced(utility)) continue

    const token = TOKEN_VALUE.exec(utility)
    if (token === null) {
      violations.push({
        found: className,
        reason: 'sets a colour, font, radius or spacing value without reading a token',
      })
      continue
    }

    const name = token[1] as string
    if (!tokens.has(name)) {
      violations.push({
        found: className,
        reason: `${name} is not a custom property themeToCssVariables emits`,
      })
    }
  }

  return violations
}

function isPoliced(utility: string): boolean {
  if (POLICED_BARE.has(utility)) return true

  // Prefix plus a value, never a bare prefix. Without that, an ordinary English
  // word in a piece of copy ("to", "size", "text") would be reported as a
  // hardcoded style, and a guard that cries wolf gets switched off.
  return POLICED_PREFIXES.some(
    (prefix) => utility.startsWith(`${prefix}-`) || utility.startsWith(`${prefix}[`)
  )
}

/** `md:hover:bg-[var(--color-accent)]` is still a `bg-` utility. */
function withoutVariants(className: string): string {
  const bracket = className.indexOf('[')
  const head = bracket === -1 ? className : className.slice(0, bracket)
  const lastVariant = head.lastIndexOf(':')
  return lastVariant === -1 ? className : className.slice(lastVariant + 1)
}

/**
 * Words from every string and template literal that reads like a class list.
 *
 * Wider than reading `className=` alone on purpose: a block that lifts its
 * classes into a `const` is doing the same thing and has to be checked the same
 * way. Narrower than every literal, because copy is a string too, and a
 * sentence is not a set of classes.
 */
function classNames(code: string): string[] {
  return classListLiterals(code).flatMap((literal) => splitClasses(literal))
}

/** The string and template literals in the source that read like a class list. */
function classListLiterals(code: string): string[] {
  const literals = code.match(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g) ?? []
  return literals.filter((literal) => splitClasses(literal).length > 0)
}

function splitClasses(literal: string): string[] {
  const words = literal
    .slice(1, -1)
    .split(/[\s${}]+/)
    .filter(Boolean)

  const looksLikeClasses =
    words.length > 0 &&
    // `#` is in the charset so that `text-[#ff0000]`, which is exactly the
    // thing this guard exists to catch, still reads as a class rather than as
    // prose and gets skipped.
    words.every((word) => /^[a-z0-9][a-z0-9:_.,%/#[\]()-]*$/.test(word)) &&
    words.some((word) => word.includes('-') || word.includes('['))

  return looksLikeClasses ? words : []
}

/**
 * Comments are stripped before anything else runs, because the comments in
 * these files talk about 320px, hex values and Tailwind classes, and a guard
 * that reads prose reports the documentation rather than the code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * The three pairings the design directions report found failing in all three
 * directions, turned into rules a block cannot break.
 *
 * They are block set rules rather than theme rules, which is the report's own
 * conclusion: "they are the same three in every direction, which makes them
 * block-set rules rather than theme-specific ones." Two halves hold the line
 * between them. The theme schema makes `accentInk` be `bg` or `surface`, so a
 * label on an accent fill is never ink whatever palette is loaded. This is the
 * other half: it stops a block choosing the pairing in the first place.
 *
 * `tests/e2e/contrast.spec.ts` is the backstop, because a static reader cannot
 * see a colour inherited across two elements. It walks the rendered page in a
 * browser and measures what a guest would actually read.
 */
const FORBIDDEN_PAIRINGS: readonly {
  readonly pattern: RegExp
  readonly reason: string
}[] = [
  {
    /*
     * `accent` on an `ink` fill measures 1.81, 2.10 and 1.73 to one. The report's
     * rule is "`accent` is never drawn on an `ink` fill, including rules and
     * icons", and the cheapest way to guarantee it is to have no ink fill at
     * all: the block set paints `bg` and `surface` and nothing else.
     */
    pattern: /\bbg-\[var\(--color-ink(?:-muted)?\)\]/,
    reason:
      'there is no ink fill in the block set, because accent on an ink fill is 1.81:1 at best',
  },
  {
    /*
     * `surface` sits about 1.1:1 against `bg` in all three directions, on
     * purpose, because a stationery card is separated by paper edge and margin
     * rather than by a colour step. So it cannot be a boundary, and neither can
     * `border`, which measures 1.29:1 and 1.43:1 in the committed placeholder
     * themes. A boundary reads `inkMuted`, which clears 3.0:1 in every theme
     * the repo ships.
     */
    pattern: /\b(?:border|ring|outline|divide)-\[color:var\(--color-(?:surface|border)\)\]/,
    reason:
      'a boundary drawn in surface or border is about 1.1:1 against the page; boundaries read --color-ink-muted',
  },
]

/** `bg-[var(--color-accent)]` in a class list, wherever it sits in it. */
const ACCENT_FILL = /\bbg-\[var\(--color-accent\)\]/
/** Any text colour set in the same class list as that fill. */
const TEXT_COLOUR = /\btext-\[color:var\((--color-[a-z-]+)\)\]/g

/**
 * Reports every place a block writes one of the pairings that fails in all
 * three design directions.
 *
 * Separate from `findStyleViolations` because it answers a different question.
 * That one asks whether a value was written down instead of consumed as a
 * token; this one asks whether two tokens were put together in a combination
 * that is unreadable in every theme the repo ships.
 */
export function findContrastViolations(source: string): StyleViolation[] {
  const code = stripComments(source)
  const violations: StyleViolation[] = []

  for (const rule of FORBIDDEN_PAIRINGS) {
    const match = rule.pattern.exec(code)
    if (match !== null) violations.push({ found: match[0], reason: rule.reason })
  }

  for (const literal of classListLiterals(code)) {
    if (!ACCENT_FILL.test(literal)) continue

    const drawn = [...literal.matchAll(TEXT_COLOUR)].map((match) => match[1] as string)

    if (drawn.length === 0) {
      violations.push({
        found: 'bg-[var(--color-accent)]',
        reason:
          'an accent fill has to name the colour of the text on it, and that colour is --color-accent-ink',
      })
      continue
    }

    for (const token of drawn) {
      if (token === '--color-accent-ink') continue
      violations.push({
        found: `bg-[var(--color-accent)] with text-[color:var(${token})]`,
        reason:
          'text on an accent fill is --color-accent-ink; ink on accent is 1.81:1 in the best of the three directions',
      })
    }
  }

  return violations
}
