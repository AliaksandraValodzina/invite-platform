import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The product is Mirthly. The working title was "Invite Platform" and it shipped
 * to a bought domain, in the browser tab and in the heading of the front page.
 *
 * A name is not the kind of thing one fix settles: the next route to be written
 * copies the shape of the last one, and a share preview is the one surface
 * nobody looks at while building. So this reads the source that renders public
 * surfaces rather than trusting that the sweep was complete.
 *
 * `package.json`, `supabase/config.toml` and the repository itself are still
 * named `invite-platform` on purpose. Those are internal names and renaming them
 * is a separate action, so this scans `src/` and the seed templates and nothing
 * else.
 */

const WORKING_TITLE = /invite\s+platform/i

const root = fileURLToPath(new URL('../../../', import.meta.url))

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)

    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path, extensions))
      continue
    }

    if (extensions.some((extension) => entry.endsWith(extension))) found.push(path)
  }

  return found
}

describe('the name a buyer or a guest can see', () => {
  it('is nowhere replaced by the working title in the app source', () => {
    const offenders = filesUnder(join(root, 'src'), ['.ts', '.tsx', '.css'])
      .filter((path) => WORKING_TITLE.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(root.length))

    expect(offenders).toEqual([])
  })

  it('is nowhere in a seed template, which is content a guest reads', () => {
    const offenders = filesUnder(join(root, 'templates'), ['.json'])
      .filter((path) => WORKING_TITLE.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(root.length))

    expect(offenders).toEqual([])
  })

  it('is the default title and the site name the root layout declares', () => {
    const layout = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8')

    expect(layout).toContain("default: 'Mirthly'")
    expect(layout).toContain("template: '%s - Mirthly'")
    expect(layout).toContain("siteName: 'Mirthly'")
  })

  it('does not reach the tab of a live invitation, which belongs to the buyer', () => {
    const guestPage = readFileSync(join(root, 'src/app/e/[slug]/page.tsx'), 'utf8')

    // `absolute` is what opts a route out of the root title template. Without
    // it the couple's names would be suffixed with the product's.
    expect(guestPage).toContain('title: { absolute: share.title }')
  })
})
