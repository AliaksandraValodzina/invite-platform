/**
 * The versioning machinery itself, tested without any block schemas in the way.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createDocumentPipeline, type DocumentMigration } from '@/lib/template'

const schemaV1 = z.strictObject({ version: z.literal(1), greeting: z.string() })
const schemaV2 = z.strictObject({
  version: z.literal(2),
  greeting: z.string(),
  language: z.string(),
})

const addLanguage: DocumentMigration = {
  from: 1,
  to: 2,
  description: 'language becomes a required field',
  migrate: (document) => ({ ...document, version: 2, language: 'en-AU' }),
}

const v1 = createDocumentPipeline({
  name: 'probe',
  version: 1,
  schema: schemaV1,
  migrations: [],
})

const v2 = createDocumentPipeline({
  name: 'probe',
  version: 2,
  schema: schemaV2,
  migrations: [addLanguage],
})

describe('the version ladder', () => {
  it('refuses to build a pipeline with a gap in it', () => {
    // A version 3 pipeline carrying only a 1 to 2 migration means every version
    // 2 document breaks the moment a guest opens it. This turns that into an
    // error at import time, which is why the failure is a throw and not an
    // outcome.
    expect(() =>
      createDocumentPipeline({
        name: 'probe',
        version: 3,
        schema: schemaV2,
        migrations: [addLanguage],
      })
    ).toThrow(/version 3 needs 2 migration\(s\), found 1/)
  })

  it('refuses a migration that skips a version', () => {
    expect(() =>
      createDocumentPipeline({
        name: 'probe',
        version: 2,
        schema: schemaV2,
        migrations: [{ ...addLanguage, to: 3 }],
      })
    ).toThrow(/migration at position 0 is 1 to 3, expected 1 to 2/)
  })
})

describe('load', () => {
  it('carries an old document forward and says that it did', () => {
    const stored = { version: 1, greeting: 'hello' }
    const outcome = v2.load(stored)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.document).toEqual({ version: 2, greeting: 'hello', language: 'en-AU' })
    expect(outcome.storedVersion).toBe(1)
    expect(outcome.migrated).toBe(true)
  })

  it('does not mutate the stored value it was handed', () => {
    // Migration happens in memory on read and is never written back. If a
    // migration mutated its input, a caller that logged the row after reading
    // it would report something that is not in the database.
    const stored = { version: 1, greeting: 'hello' }
    v2.load(stored)

    expect(stored).toEqual({ version: 1, greeting: 'hello' })
  })

  it('reports a document from a future version rather than guessing at it', () => {
    const outcome = v1.load({ version: 2, greeting: 'hello', language: 'en-AU' })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('newer-than-supported')
    expect(outcome.storedVersion).toBe(2)
    // Rollback is the usual cause, and the row is fine. Nothing is repaired here.
    expect(outcome.stored).toEqual({ version: 2, greeting: 'hello', language: 'en-AU' })
  })

  it.each([
    ['a string', 'not a document'],
    ['an array', [{ version: 1 }]],
    ['null', null],
  ])('reports %s as not an object', (_name, stored) => {
    const outcome = v1.load(stored)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('not-an-object')
    expect(outcome.stored).toEqual(stored)
  })

  it.each([
    ['absent', {}],
    ['a string', { version: '1' }],
    ['zero', { version: 0 }],
    ['fractional', { version: 1.5 }],
  ])('reports a version that is %s', (_name, stored) => {
    const outcome = v1.load(stored)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('missing-version')
  })

  it('reports a migration that threw as a code failure, naming the migration', () => {
    const broken = createDocumentPipeline({
      name: 'probe',
      version: 2,
      schema: schemaV2,
      migrations: [
        {
          from: 1,
          to: 2,
          description: 'reads a field that is not there',
          migrate: () => {
            throw new TypeError('cannot read properties of undefined')
          },
        },
      ],
    })

    const outcome = broken.load({ version: 1, greeting: 'hello' })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('migration-failed')
    expect(outcome.message).toContain('reads a field that is not there')
    expect(outcome.message).toContain('cannot read properties of undefined')
  })

  it('reports a document that is still invalid after migrating, with paths', () => {
    const outcome = v1.load({ version: 1, greeting: 42 })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('invalid')
    expect(outcome.issues.map((issue) => issue.path)).toContain('greeting')
  })

  it('refuses a stale version on a write path', () => {
    // A write path is handing over a document it just built, so an old version
    // means a bug in the caller rather than an old row.
    const outcome = v2.load({ version: 1, greeting: 'hello' }, { migrate: false })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('stale-version')
  })

  it('accepts a current version document on a write path', () => {
    const outcome = v2.load(
      { version: 2, greeting: 'hello', language: 'en-AU' },
      { migrate: false }
    )

    expect(outcome.ok).toBe(true)
  })
})

describe('parse', () => {
  it('throws with the failing paths, for seeds and fixtures', () => {
    expect(() => v1.parse({ version: 1, greeting: 42 })).toThrow(/greeting/)
  })

  it('returns the document when it is valid', () => {
    expect(v1.parse({ version: 1, greeting: 'hello' })).toEqual({ version: 1, greeting: 'hello' })
  })
})
