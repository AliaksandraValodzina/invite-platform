import { describe, expect, it } from 'vitest'

import { submitRsvp } from '@/app/e/[slug]/actions'

/**
 * The one thing stage 1 must not do quietly.
 *
 * The RSVP block takes `submit` as a required prop so a form with nowhere to
 * send a reply cannot be rendered by accident. The reply path is stage 2, so
 * this stage has to answer that prop with something, and the tempting answer,
 * `{ ok: true }`, is the worst outcome available: the guest is thanked, the
 * buyer sees nothing, and no test anywhere goes red. This asserts the refusal,
 * so turning it into a success takes deleting a test that says why not to.
 */

describe('the guest page RSVP seam', () => {
  it('refuses rather than pretending a reply was stored', async () => {
    const result = await submitRsvp(new FormData())

    expect(result.ok).toBe(false)
  })

  it('tells the guest nothing was sent, in words meant for a guest', async () => {
    const result = await submitRsvp(new FormData())

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.message).toContain('Nothing was sent')
    expect(result.message.length).toBeGreaterThan(20)
  })
})
