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
  const literals = code.match(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g) ?? []

  return literals.flatMap((literal) => {
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
  })
}

/**
 * Comments are stripped before anything else runs, because the comments in
 * these files talk about 320px, hex values and Tailwind classes, and a guard
 * that reads prose reports the documentation rather than the code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
