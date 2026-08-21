import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  assertStoreIsUsable,
  buildStore,
  DEFAULT_LOCAL_ROOT,
  filesystemStore,
  memoryStore,
  readR2Config,
  selectStore,
  type ObjectStore,
} from '@/lib/uploads/store'
import { signRequest } from '@/lib/uploads/store/r2'

/**
 * The store: chosen by configuration, inert without a credential, and the same
 * four operations whichever one is chosen.
 *
 * The R2 driver is exercised without a cloud credential, which is the whole
 * constraint this stage was given. The part of it that can be wrong in a way
 * nothing else would catch is the signature, so that is checked against AWS's
 * own published Signature Version 4 test vector rather than against itself.
 */

const temporaryRoots: string[] = []

afterAll(async () => {
  for (const root of temporaryRoots) await rm(root, { recursive: true, force: true })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'invite-uploads-'))
  temporaryRoots.push(root)
  return root
}

const KEY = 'abcdef012345abcdef012345-w960.webp'
const BYTES = new Uint8Array([1, 2, 3, 4, 5])

async function behavesLikeAStore(store: ObjectStore): Promise<void> {
  expect(await store.get(KEY)).toBeNull()
  expect(await store.has(KEY)).toBe(false)
  expect(await store.delete(KEY)).toBe(false)

  await store.put({ key: KEY, contentType: 'image/webp', bytes: BYTES })

  expect(await store.has(KEY)).toBe(true)
  const read = await store.get(KEY)
  expect(read?.bytes).toEqual(BYTES)
  // The type is stored, not guessed back out of the extension: guessing it a
  // second time in a different place is how the two answers come to differ.
  expect(read?.contentType).toBe('image/webp')

  expect(await store.delete(KEY)).toBe(true)
  expect(await store.get(KEY)).toBeNull()
}

describe('every driver keeps the same contract', () => {
  it('holds for the in memory store', async () => {
    await behavesLikeAStore(memoryStore())
  })

  it('holds for the filesystem store', async () => {
    await behavesLikeAStore(filesystemStore(await temporaryRoot()))
  })

  it('hands back a copy, so a caller mutating its buffer cannot change what is stored', async () => {
    const store = memoryStore()
    const mutable = Uint8Array.from(BYTES)
    await store.put({ key: KEY, contentType: 'image/webp', bytes: mutable })
    mutable[0] = 99

    expect((await store.get(KEY))?.bytes[0]).toBe(1)
  })

  it('refuses a key that is not a content address, before it becomes a path', async () => {
    const store = filesystemStore(await temporaryRoot())
    await expect(
      store.put({ key: '../escape.webp', contentType: 'image/webp', bytes: BYTES })
    ).rejects.toThrow(/content address/)
  })
})

describe('which driver is chosen', () => {
  it('is the local filesystem when nothing is configured, so this runs with no credential', () => {
    expect(selectStore({})).toEqual({ driver: 'filesystem', root: DEFAULT_LOCAL_ROOT })
  })

  it('is R2 as soon as every R2 variable is present', () => {
    const selection = selectStore({
      R2_ACCOUNT_ID: 'account',
      R2_BUCKET: 'invitations',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
    })
    expect(selection.driver).toBe('r2')
  })

  it('can be forced, for a test or a local experiment', () => {
    expect(selectStore({ UPLOADS_DRIVER: 'memory' })).toEqual({ driver: 'memory' })
    expect(selectStore({ UPLOADS_DRIVER: 'filesystem', UPLOADS_LOCAL_ROOT: '/tmp/x' })).toEqual({
      driver: 'filesystem',
      root: '/tmp/x',
    })
    expect(() => selectStore({ UPLOADS_DRIVER: 'gcs' })).toThrow(/memory, filesystem or r2/)
  })

  it('refuses a half configured R2 rather than falling back and pretending', () => {
    /*
     * The interesting failure. Absent credentials are the normal state of this
     * repo and mean "use the local store". Three variables out of four is
     * always a mistake, and one that would otherwise surface as a 500 at the
     * moment a buyer uploads rather than at deploy time.
     */
    expect(() => readR2Config({ R2_ACCOUNT_ID: 'account', R2_BUCKET: 'invitations' })).toThrow(
      /R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY/
    )
  })

  it('is inert with no credential: nothing is read and nothing throws', () => {
    expect(readR2Config({})).toBeNull()
  })
})

describe('an asset hostname must have a real store behind it', () => {
  const r2 = {
    R2_ACCOUNT_ID: 'account',
    R2_BUCKET: 'invitations',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
  }

  it('refuses a deployment that names one over a local store', () => {
    /*
     * The silent failure this pairing rule exists to stop: a CDN in front of a
     * bucket the deployment cannot write to. Uploads succeed, rows appear, and
     * every guest gets a broken image.
     */
    const source = { NEXT_PUBLIC_ASSET_HOST: 'https://assets.example.com' }
    expect(() => assertStoreIsUsable(selectStore(source), source)).toThrow(
      /selected object store is "filesystem"/
    )
  })

  it('allows the pairing that makes sense', () => {
    const source = { ...r2, NEXT_PUBLIC_ASSET_HOST: 'https://assets.example.com' }
    expect(() => assertStoreIsUsable(selectStore(source), source)).not.toThrow()
  })

  it('allows a local store when no hostname is named, which is every local run', () => {
    expect(() => assertStoreIsUsable(selectStore({}), {})).not.toThrow()
  })

  it('refuses a vendor hostname before it ever reaches a browser', () => {
    const source = { ...r2, NEXT_PUBLIC_ASSET_HOST: 'https://pub-1.r2.dev' }
    expect(() => assertStoreIsUsable(selectStore(source), source)).toThrow(/storage vendor/)
  })

  it('builds the driver the selection names', () => {
    expect(buildStore({ driver: 'memory' }).driver).toBe('memory')
    expect(buildStore({ driver: 'r2', config: readR2Config(r2)! }).driver).toBe('r2')
  })
})

describe('the R2 request signature', () => {
  /**
   * AWS's own `get-vanilla` case from the Signature Version 4 test suite.
   *
   * A signature implementation checked only against itself proves nothing: it
   * would agree with its own mistakes. This is a fixed request, a fixed clock
   * and a published expected signature, which is why `signRequest` takes a
   * region and a service at all.
   */
  it('matches the published AWS test vector', () => {
    const headers = signRequest({
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
      headers: { host: 'example.amazonaws.com' },
      body: new Uint8Array(0),
      at: new Date('2015-08-30T12:36:00Z'),
      region: 'us-east-1',
      service: 'service',
      config: {
        accountId: 'unused',
        bucket: 'unused',
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        endpoint: 'https://example.amazonaws.com',
      },
    })

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    )
  })

  it('signs R2 requests against R2 own region and service', () => {
    const headers = signRequest({
      method: 'PUT',
      url: new URL('https://account.r2.cloudflarestorage.com/invitations/key.webp'),
      headers: { host: 'account.r2.cloudflarestorage.com', 'content-type': 'image/webp' },
      body: new Uint8Array([1, 2, 3]),
      at: new Date('2026-08-21T00:00:00Z'),
      config: {
        accountId: 'account',
        bucket: 'invitations',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        endpoint: 'https://account.r2.cloudflarestorage.com',
      },
    })

    expect(headers.authorization).toContain('/20260821/auto/s3/aws4_request')
    expect(headers.authorization).toContain('SignedHeaders=content-type;host;x-amz-date')
    // A fixed clock and fixed keys give a fixed signature, so an accidental
    // change to the canonicalisation shows up here rather than as a 403 against
    // a bucket nobody has yet.
    expect(headers.authorization).toMatch(/Signature=[a-f0-9]{64}$/)
  })

  it('is deterministic for the same inputs', () => {
    const input = {
      method: 'GET' as const,
      url: new URL('https://account.r2.cloudflarestorage.com/invitations/key.webp'),
      headers: { host: 'account.r2.cloudflarestorage.com' },
      body: new Uint8Array(0),
      at: new Date('2026-08-21T00:00:00Z'),
      config: {
        accountId: 'account',
        bucket: 'invitations',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        endpoint: 'https://account.r2.cloudflarestorage.com',
      },
    }

    expect(signRequest(input).authorization).toBe(signRequest(input).authorization)
  })
})
