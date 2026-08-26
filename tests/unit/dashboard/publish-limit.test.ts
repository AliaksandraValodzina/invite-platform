import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { alreadyPublished, PUBLISH_LIMIT_MARKER } from '@/lib/editor/publish-limit'

/**
 * One published invitation at a time per account, and the seam between the
 * database that enforces it and the route that words the refusal.
 *
 * The captain's decision of 2026-08-24. It matters more than it looks, because
 * the free launch opened `/t/<templateId>/use`: anybody may mint unlimited
 * copies of a free template, and this limit is the only thing between that and
 * somebody running a wedding business on one design. Every published event
 * costs hosting for its full term.
 *
 * The rule lives in `public.events_publish_limit`, not in the route, because
 * two publish presses in two tabs are two requests and a check in front of a
 * write can be raced. The route reads the database's own sentence to tell that
 * refusal apart from every other constraint on `events`, which makes the
 * migration's wording load bearing for a file that is nowhere near it. That is
 * exactly the kind of join that rots silently, so it is pinned here.
 */

const MIGRATION = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260826010000_one_published_invitation.sql',
    import.meta.url
  )
)

const source = readFileSync(MIGRATION, 'utf8')

describe('the refusal the route recognises', () => {
  it('is the sentence the migration actually raises', () => {
    expect(source).toContain(PUBLISH_LIMIT_MARKER)
  })

  it('is raised, rather than merely mentioned in a comment', () => {
    const raise = source.slice(source.indexOf('raise exception'))
    expect(raise).toContain(PUBLISH_LIMIT_MARKER)
  })
})

describe('what the buyer is told', () => {
  it('names the invitation in the way, so the limit is something to act on', () => {
    const result = alreadyPublished('Wilhelmina and Bartholomew')

    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.message).toContain('Wilhelmina and Bartholomew')
    // The way through. A limit with no stated way past it reads as a bug.
    expect(result.status === 'failed' && result.message).toContain('Take that one down')
  })

  it('still makes sense on the raced path, where there is no title to name', () => {
    const result = alreadyPublished(null)

    expect(result.status === 'failed' && result.message).toContain('Another invitation')
    expect(result.status === 'failed' && result.message).not.toContain('null')
  })
})

describe('what the migration limits', () => {
  it('limits publishing and nothing else, so drafts and copies stay unlimited', () => {
    // The early return is the whole of "a draft costs nothing". Losing it would
    // cap the copies the open link exists to hand out.
    expect(source).toContain("if new.status <> 'published' then")
  })

  it('serialises the presses that could collide, so two tabs cannot both win', () => {
    // A bare `exists` check passes in both of two concurrent transactions under
    // READ COMMITTED. The lock is what makes the limit true rather than likely.
    expect(source).toContain('pg_advisory_xact_lock')
  })

  it('is enforced against the role a buyer actually holds', () => {
    expect(source).toContain("if current_user <> 'authenticated' then")
  })
})
