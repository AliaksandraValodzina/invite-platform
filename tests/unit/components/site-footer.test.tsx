import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GUEST_NOTICE_KINDS, GuestNotice } from '@/components/guest-notice'
import { SiteFooter } from '@/components/site-footer'

/**
 * The privacy statement and the terms, reachable without knowing the path.
 *
 * Both documents shipped before anything linked to them, which meant the only
 * people who could read them were the people who already knew where they were.
 * The assertion worth defending is not that a footer element exists: it is that
 * the two hrefs are there, on every page a stranger can arrive on. A footer
 * rendering with one link, or with a link to a route that does not exist, looks
 * right in a screenshot and is the failure this is written against.
 *
 * The browser walk in tests/e2e/legal-links.spec.ts follows the links to the
 * pages themselves. This half is what fails fast when a route drops the footer.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url))

function markup(node: React.ReactElement): string {
  return renderToStaticMarkup(node)
}

describe('the footer', () => {
  it('carries both documents, not just the privacy statement', () => {
    const html = markup(<SiteFooter />)

    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/terms"')
  })

  it('names the product whose statement the links lead to', () => {
    expect(markup(<SiteFooter />)).toContain('Mirthly')
  })
})

describe('the pages a stranger can arrive on', () => {
  it('puts it under every guest notice, including the ones nobody chose to visit', () => {
    for (const kind of GUEST_NOTICE_KINDS) {
      const html = markup(<GuestNotice kind={kind} />)

      expect(html, `the ${kind} notice`).toContain('href="/privacy"')
      expect(html, `the ${kind} notice`).toContain('href="/terms"')
    }
  })

  /*
   * Read off disk rather than rendered, because these are async server
   * components that reach the database. What is being checked is that the
   * route still asks for the footer at all, which is the thing a later edit
   * silently drops.
   */
  it('is asked for by every route that faces the public', () => {
    const routes = [
      'src/app/page.tsx',
      'src/app/e/[slug]/page.tsx',
      'src/app/t/[templateId]/page.tsx',
    ]

    for (const route of routes) {
      const source = readFileSync(`${root}${route}`, 'utf8')

      expect(source, route).toContain("import { SiteFooter } from '@/components/site-footer'")
      expect(source, route).toContain('<SiteFooter />')
    }
  })

  /*
   * The invitation page draws the footer outside the theme scope on purpose:
   * it is the product talking, not the couple's design. Inside it, the footer
   * would inherit a palette it never declared tokens for, which is the failure
   * the block rule exists to prevent.
   */
  it('draws it outside the invitation theme, not inside it', () => {
    const source = readFileSync(`${root}src/app/e/[slug]/page.tsx`, 'utf8')
    const closingScope = source.indexOf('</ThemeScope>')
    const footer = source.indexOf('<SiteFooter />')

    expect(closingScope).toBeGreaterThan(-1)
    expect(footer).toBeGreaterThan(closingScope)
  })
})
