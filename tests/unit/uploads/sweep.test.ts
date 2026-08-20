import { describe, expect, it } from 'vitest'

import { memoryStore } from '@/lib/uploads/store'
import { sweepUploadObjects, type SweepDeps } from '@/lib/uploads/sweep'

/**
 * The half of retention that Postgres cannot do.
 *
 * The plan is explicit that this is the work that gets silently skipped: "The
 * existing sweep only touches Postgres, so R2 deletion is new work and it is
 * the kind of work that is silently skipped. It needs its own assertion." A
 * retention promise that ends at a database row is not a retention promise, so
 * these assertions are about bytes leaving a store.
 *
 * The reference check that stops one event's takedown blanking another's page
 * lives in SQL, in `public.claim_upload_objects`, and is asserted there, in
 * `supabase/tests/09_uploads.test.sql`. What is asserted here is that this
 * function deletes exactly what it was handed and nothing it was not, which is
 * the other half of the same guarantee: a sweep that went looking for more work
 * than it was given would walk straight around that check.
 */

function deps(store = memoryStore(), queue: string[] = []): SweepDeps & { marked: string[] } {
  const marked: string[] = []
  return {
    marked,
    async claim(limit) {
      return queue.slice(0, limit)
    },
    remove: (key) => store.delete(key),
    async mark(key) {
      marked.push(key)
      return true
    },
  }
}

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa-w960.webp'
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb-w960.webp'
const C = 'cccccccccccccccccccccccc-orig.jpg'

async function seeded(keys: readonly string[]) {
  const store = memoryStore()
  for (const key of keys) {
    await store.put({ key, contentType: 'image/webp', bytes: new Uint8Array([1, 2, 3]) })
  }
  return store
}

describe('draining the queue', () => {
  it('removes the bytes of every key it is given', async () => {
    const store = await seeded([A, B, C])
    const report = await sweepUploadObjects(deps(store, [A, B]))

    expect(report).toMatchObject({ claimed: 2, deleted: 2, missing: 0, failed: [] })
    expect(await store.has(A)).toBe(false)
    expect(await store.has(B)).toBe(false)
  })

  it('touches nothing it was not given, which is where the shared key rule is honoured', async () => {
    /*
     * `claim_upload_objects` is what decides that a key two events share is not
     * yet deletable. This function must not widen that decision: it deletes the
     * list, not everything queued, not everything in the store.
     */
    const store = await seeded([A, B, C])
    await sweepUploadObjects(deps(store, [A]))

    expect(await store.has(B)).toBe(true)
    expect(await store.has(C)).toBe(true)
  })

  it('marks each key done, so an interrupted run resumes rather than starting over', async () => {
    const store = await seeded([A, B])
    const dependencies = deps(store, [A, B])
    await sweepUploadObjects(dependencies)

    expect(dependencies.marked).toEqual([A, B])
  })

  it('counts a key that was already gone rather than treating it as a failure', async () => {
    /*
     * The normal outcome of a re-run, and of a key two uploads shared where one
     * was swept first. Calling it a failure would make an alert on `failed`
     * useless within a week.
     */
    const store = await seeded([A])
    const report = await sweepUploadObjects(deps(store, [A, B]))

    expect(report).toMatchObject({ claimed: 2, deleted: 1, missing: 1, failed: [] })
  })

  it('leaves a key queued when the store refuses it, and keeps going', async () => {
    const store = await seeded([A, B])
    const dependencies = deps(store, [A, B])
    const failing: SweepDeps = {
      ...dependencies,
      remove: async (key) => {
        if (key === A) throw new Error('the store is unreachable')
        return store.delete(key)
      },
    }

    const report = await sweepUploadObjects(failing)

    expect(report.failed).toEqual([A])
    // The one that could be removed still was: a single unreachable object must
    // not stop the rest of a retention sweep.
    expect(report.deleted).toBe(1)
    expect(await store.has(B)).toBe(false)
    // And the failed one is not marked, so the next run tries it again.
    expect(dependencies.marked).not.toContain(A)
  })

  it('does nothing at all when there is nothing queued', async () => {
    const report = await sweepUploadObjects(deps(await seeded([A]), []))
    expect(report).toMatchObject({ claimed: 0, deleted: 0, missing: 0, failed: [] })
  })

  it('honours the batch size it is given', async () => {
    const store = await seeded([A, B, C])
    const report = await sweepUploadObjects(deps(store, [A, B, C]), 2)

    expect(report.claimed).toBe(2)
    expect(await store.has(C)).toBe(true)
  })
})
