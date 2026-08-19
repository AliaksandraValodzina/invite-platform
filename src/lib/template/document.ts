/**
 * The versioning machinery. This is the part of the format that is expensive to
 * get wrong, so it is small, generic, and shared by all three documents
 * (definition, theme, content).
 *
 * The claim it exists to make good on: an event written against version N still
 * renders after we change a block schema and ship version N+1.
 *
 * How: a stored document carries its own `version`. On read, migrations are
 * applied in order from the stored version up to the current one, in memory,
 * and only then is the result validated against the current schema. Old
 * documents are therefore never invalid, they are just old.
 *
 * Two properties of this design are deliberate and worth defending.
 *
 * Migration happens on READ and is never written back. A guest page renders a
 * migrated document; the database still holds the original until the buyer next
 * saves. That means a bad migration is fixed by deploying a fix, not by
 * restoring a backup, and it means we can never corrupt a buyer's stored
 * content by reading it.
 *
 * Reads never throw. `load` returns an outcome. A guest arriving from a group
 * chat gets a designed page or a designed error state, never a stack trace, and
 * the caller always gets the raw stored value back so the failure can be
 * reported without losing what the buyer wrote.
 */

import { z } from 'zod'

export type JsonObject = Record<string, unknown>

/**
 * One step of the version ladder. Always exactly one version, never a jump: a
 * migration that skips versions cannot be composed with the ones either side of
 * it, and the ladder is the thing that makes an arbitrarily old document
 * readable.
 */
export type DocumentMigration = {
  readonly from: number
  readonly to: number
  /** Read by humans in a review, and printed when a migration throws. */
  readonly description: string
  readonly migrate: (document: JsonObject) => JsonObject
}

export type DocumentIssue = {
  readonly path: string
  readonly message: string
}

export type LoadFailureReason =
  /** Not a JSON object at all. A column that should hold a document holds something else. */
  | 'not-an-object'
  /** No usable `version`. Predates the format, or was written by something that is not us. */
  | 'missing-version'
  /** Stored version is higher than this deploy understands. Usually a rollback. */
  | 'newer-than-supported'
  /** Stored version is older and `migrate: false` was asked for. Write paths use this. */
  | 'stale-version'
  /** A migration function threw. A code bug, not a data problem. */
  | 'migration-failed'
  /** Migrated to the current version and still did not satisfy the current schema. */
  | 'invalid'

export type LoadOutcome<T> =
  | {
      readonly ok: true
      readonly document: T
      readonly storedVersion: number
      /** True when migrations ran. The caller may want to log it; it must not write it back. */
      readonly migrated: boolean
    }
  | {
      readonly ok: false
      readonly reason: LoadFailureReason
      readonly message: string
      readonly storedVersion: number | null
      readonly issues: readonly DocumentIssue[]
      /** The stored value, verbatim. Nothing is ever dropped on the floor. */
      readonly stored: unknown
    }

export type DocumentPipeline<T> = {
  readonly name: string
  readonly version: number
  readonly migrations: readonly DocumentMigration[]
  /**
   * Read path by default. Pass `{ migrate: false }` on a write path, where the
   * caller is handing over a document it just built and a stale version means a
   * bug in the caller rather than an old row.
   */
  load(stored: unknown, options?: { readonly migrate?: boolean }): LoadOutcome<T>
  /** Throwing wrapper for seeds, fixtures and tests. Never use it on a request path. */
  parse(stored: unknown): T
}

export function createDocumentPipeline<T>(spec: {
  readonly name: string
  readonly version: number
  readonly schema: z.ZodType<T>
  readonly migrations: readonly DocumentMigration[]
}): DocumentPipeline<T> {
  assertLadderIsComplete(spec.name, spec.version, spec.migrations)

  function load(stored: unknown, options?: { readonly migrate?: boolean }): LoadOutcome<T> {
    const shouldMigrate = options?.migrate ?? true

    if (!isJsonObject(stored)) {
      return failure('not-an-object', `${spec.name} is not a JSON object`, null, [], stored)
    }

    const storedVersion = stored.version
    if (
      typeof storedVersion !== 'number' ||
      !Number.isInteger(storedVersion) ||
      storedVersion < 1
    ) {
      return failure(
        'missing-version',
        `${spec.name} has no usable version field`,
        null,
        [{ path: 'version', message: 'must be a positive integer' }],
        stored
      )
    }

    if (storedVersion > spec.version) {
      return failure(
        'newer-than-supported',
        `${spec.name} is at version ${storedVersion} and this deploy understands ${spec.version}. ` +
          'Serve the designed error state rather than guessing at a shape we do not know.',
        storedVersion,
        [],
        stored
      )
    }

    if (storedVersion < spec.version && !shouldMigrate) {
      return failure(
        'stale-version',
        `${spec.name} is at version ${storedVersion} and this path requires ${spec.version}`,
        storedVersion,
        [],
        stored
      )
    }

    let current: JsonObject = stored
    for (const migration of spec.migrations) {
      if (migration.from < storedVersion) continue

      try {
        current = migration.migrate(current)
      } catch (error) {
        return failure(
          'migration-failed',
          `${spec.name} migration ${migration.from} to ${migration.to} (${migration.description}) threw: ${describeError(error)}`,
          storedVersion,
          [],
          stored
        )
      }
    }

    const parsed = spec.schema.safeParse(current)
    if (!parsed.success) {
      return failure(
        'invalid',
        `${spec.name} did not satisfy version ${spec.version} after migration`,
        storedVersion,
        toIssues(parsed.error),
        stored
      )
    }

    return {
      ok: true,
      document: parsed.data,
      storedVersion,
      migrated: storedVersion !== spec.version,
    }
  }

  return {
    name: spec.name,
    version: spec.version,
    migrations: spec.migrations,
    load,
    parse(stored: unknown): T {
      const outcome = load(stored)
      if (outcome.ok) return outcome.document

      const detail = outcome.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')
      throw new Error([`${outcome.message} (${outcome.reason})`, detail].filter(Boolean).join('\n'))
    },
  }
}

/**
 * A gap in the ladder is a startup error, not a runtime surprise. Shipping
 * version 3 with only a 1 to 2 migration means every version 2 event breaks the
 * moment a guest opens it, and this turns that into a failure at import time
 * that a unit test catches before it can reach production.
 */
function assertLadderIsComplete(
  name: string,
  version: number,
  migrations: readonly DocumentMigration[]
): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`${name}: version must be a positive integer, got ${version}`)
  }

  if (migrations.length !== version - 1) {
    throw new Error(
      `${name}: version ${version} needs ${version - 1} migration(s), found ${migrations.length}. ` +
        'Every version between 1 and the current one must have a way forward.'
    )
  }

  migrations.forEach((migration, index) => {
    const expectedFrom = index + 1
    if (migration.from !== expectedFrom || migration.to !== expectedFrom + 1) {
      throw new Error(
        `${name}: migration at position ${index} is ${migration.from} to ${migration.to}, ` +
          `expected ${expectedFrom} to ${expectedFrom + 1}`
      )
    }
  })
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toIssues(error: z.ZodError): DocumentIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
    message: issue.message,
  }))
}

function failure(
  reason: LoadFailureReason,
  message: string,
  storedVersion: number | null,
  issues: readonly DocumentIssue[],
  stored: unknown
): LoadOutcome<never> {
  return { ok: false, reason, message, storedVersion, issues, stored }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
