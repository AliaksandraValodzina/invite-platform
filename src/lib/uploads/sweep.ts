/**
 * Removing bytes the database has condemned.
 *
 * This is the half of retention that Postgres cannot do, and the plan says
 * plainly why it needs its own assertion: "The existing sweep only touches
 * Postgres, so R2 deletion is new work and it is the kind of work that is
 * silently skipped." A retention promise that ends at a row is not a retention
 * promise. `tests/unit/uploads/sweep.test.ts` drives this against a real store
 * and asserts the bytes are gone, and asserts the other thing, which is harder
 * and worse to get wrong.
 *
 * **The other thing: a shared key must survive.** Keys are content addressed,
 * so two events that upload the same file get one object with two rows pointing
 * at it. Deleting an object because one of them finished would blank the
 * other's page, and it would do it silently, months later, to somebody whose
 * hosting is paid up. `public.claim_upload_objects` is where that check lives,
 * in SQL, because it has to be a query over live rows and not a set held in a
 * process. This function does not re-implement it and must not: it deletes what
 * it is handed, marks each key done as it goes, and reports.
 *
 * Marking as it goes, rather than at the end, is what makes an interrupted run
 * resumable. A sweep that deleted a hundred objects and then died before
 * recording any of them would try them all again on the next run, which is
 * harmless, and a sweep that recorded them before deleting would lose the list,
 * which is not.
 */

export type SweepDeps = {
  /** Object keys the database says nothing live references. */
  claim(limit: number): Promise<string[]>
  /** Removes the bytes. True when they were there. */
  remove(key: string): Promise<boolean>
  /** Records that the key is done, so the next run does not reconsider it. */
  mark(key: string): Promise<boolean>
}

export type SweepReport = {
  readonly claimed: number
  /** Keys whose bytes were there and are now gone. */
  readonly deleted: number
  /**
   * Keys that were already absent from the store.
   *
   * Not an error, and worth counting separately rather than folding into
   * `deleted`. It is the normal outcome of a re-run, and of a key that two
   * uploads shared where one of them was swept first.
   */
  readonly missing: number
  /** Keys the store refused. They stay queued and the next run tries again. */
  readonly failed: readonly string[]
}

/** How many objects one call will remove. Bounded so a sweep is a short job. */
export const SWEEP_BATCH = 200

export async function sweepUploadObjects(
  deps: SweepDeps,
  limit: number = SWEEP_BATCH
): Promise<SweepReport> {
  const keys = await deps.claim(limit)

  let deleted = 0
  let missing = 0
  const failed: string[] = []

  for (const key of keys) {
    let existed: boolean
    try {
      existed = await deps.remove(key)
    } catch {
      failed.push(key)
      continue
    }

    if (existed) deleted += 1
    else missing += 1

    try {
      await deps.mark(key)
    } catch {
      /*
       * The bytes are gone and the row still says pending. The next run claims
       * it again, finds nothing, and marks it then. Counting it as failed would
       * be wrong: the thing this exists to do has happened.
       */
      failed.push(key)
    }
  }

  return { claimed: keys.length, deleted, missing, failed }
}
