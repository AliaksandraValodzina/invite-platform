/**
 * The bridge between a theme document and the blocks.
 *
 * `themeToCssVariables` is the only thing in the product that turns a token
 * into CSS, and this is the only thing that puts those custom properties on an
 * element. Everything a block draws reads them from here, which is what makes
 * "a block consumes tokens and nothing else" a rule that can be checked rather
 * than a rule that gets apologised for. tests/unit/components/block-tokens.test.ts
 * is the check.
 *
 * It is a plain element rather than a React context on purpose. Tokens have to
 * reach the browser as inherited custom properties anyway, so a context would
 * be a second copy of the same state, and it would not reach a nested client
 * component that never subscribed to it.
 */

import type { CSSProperties, ReactNode } from 'react'

import { themeToCssVariables, type ThemeTokens } from '@/lib/template'

export function ThemeScope({
  tokens,
  children,
}: {
  readonly tokens: ThemeTokens
  readonly children: ReactNode
}) {
  return (
    <div
      data-theme-scope=""
      // Custom properties are valid in a style object at runtime; the React
      // types only describe known CSS properties, hence the cast.
      style={themeToCssVariables(tokens) as CSSProperties}
      className="type-body min-h-dvh w-full bg-[var(--color-bg)] text-[color:var(--color-ink)]"
    >
      {/*
       * The reading measure lives here rather than in a block, because it is a
       * property of the page canvas rather than of any one section, and because
       * `prose` is expressed in `ch`, so it scales with whatever body face the
       * theme sets instead of pinning a width in pixels.
       */}
      <div className="mx-auto w-full max-w-prose">{children}</div>
    </div>
  )
}
