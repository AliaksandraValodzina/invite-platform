import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GUEST_NOTICE_KINDS, GuestNotice, type GuestNoticeKind } from '@/components/guest-notice'

/**
 * The designed states, read rather than counted.
 *
 * The failure this guards against is not "the notice did not render". It is the
 * expired copy appearing on the 404, or two states quietly sharing one message,
 * which looks fine in a screenshot and is wrong for whoever is holding the link.
 * So the assertion is that every kind says a different thing, and that each says
 * the thing it is for.
 */

function markup(kind: GuestNoticeKind): string {
  return renderToStaticMarkup(<GuestNotice kind={kind} />)
}

function heading(kind: GuestNoticeKind): string {
  const match = /<h1[^>]*>([^<]*)<\/h1>/.exec(markup(kind))
  if (match?.[1] === undefined) throw new Error(`${kind} rendered no h1`)
  return match[1]
}

describe('GuestNotice', () => {
  it('covers exactly the states a guest can arrive in', () => {
    expect([...GUEST_NOTICE_KINDS].sort()).toEqual([
      'expired',
      'not-found',
      'unavailable',
      'unpublished',
    ])
  })

  it('gives every state its own words', () => {
    const headings = GUEST_NOTICE_KINDS.map(heading)

    expect(new Set(headings).size).toBe(GUEST_NOTICE_KINDS.length)
    for (const line of headings) expect(line.length).toBeGreaterThan(10)
  })

  it('says what each state actually is', () => {
    expect(heading('not-found')).toContain('does not lead anywhere')
    expect(heading('unpublished')).toContain('not ready yet')
    expect(heading('expired')).toContain('closed')
    expect(heading('unavailable')).toContain('could not be loaded')
  })

  it('marks which state it is, so a browser test can read it back', () => {
    for (const kind of GUEST_NOTICE_KINDS) {
      expect(markup(kind)).toContain(`data-notice="${kind}"`)
    }
  })

  it('puts the heading in an h1, because it is the only thing on the page', () => {
    for (const kind of GUEST_NOTICE_KINDS) {
      expect(markup(kind)).toMatch(/<h1[^>]*>/)
    }
  })
})
