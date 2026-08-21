import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ADDRESS_LENGTH,
  ASSET_CACHE_CONTROL,
  ASSET_MAX_AGE_SECONDS,
  assetETag,
  contentAddress,
  isAssetKey,
} from '@/lib/uploads'

/**
 * Content addressing, and the cache lifetime that only it makes safe.
 *
 * The two are one decision. `immutable` tells a browser not to ask again, ever,
 * for a year. That is only ever true because the key is the hash of the bytes
 * at it, so these assertions are about that property rather than about a string
 * format: the same bytes always land at the same address, different bytes never
 * do, and a label cannot make two different objects collide.
 */

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL('../../../supabase/migrations/20260821010300_uploads.sql', import.meta.url)
  ),
  'utf8'
)

const HELLO = new TextEncoder().encode('hello')
const WORLD = new TextEncoder().encode('world')

describe('the address is the bytes', () => {
  it('gives the same bytes the same key every time', () => {
    expect(contentAddress(HELLO, { extension: 'webp' })).toBe(
      contentAddress(Uint8Array.from(HELLO), { extension: 'webp' })
    )
  })

  it('gives different bytes a different key, which is what deletes cache invalidation', () => {
    expect(contentAddress(HELLO, { extension: 'webp' })).not.toBe(
      contentAddress(WORLD, { extension: 'webp' })
    )
  })

  it('keeps derivatives of one file apart by label', () => {
    const small = contentAddress(HELLO, { label: 'w480', extension: 'webp' })
    const large = contentAddress(HELLO, { label: 'w1600', extension: 'webp' })
    expect(small).not.toBe(large)
    expect(small).toContain('-w480.')
  })

  it('keeps enough of the hash that a collision is not reachable by this product', () => {
    /*
     * The plan's example used 12 hex characters, which is 48 bits and an even
     * chance of a collision at about 16 million objects. That is inside this
     * product's own lifetime, and the failure is one buyer's photograph
     * appearing on another buyer's invitation. 24 characters is 96 bits.
     */
    expect(ADDRESS_LENGTH).toBeGreaterThanOrEqual(24)
    expect(contentAddress(HELLO, { extension: 'webp' })).toMatch(
      new RegExp(`^[a-f0-9]{${ADDRESS_LENGTH}}\\.webp$`)
    )
  })
})

describe('the key shape is the same in TypeScript and in SQL', () => {
  it('accepts what the database accepts', () => {
    for (const key of [
      contentAddress(HELLO, { extension: 'webp' }),
      contentAddress(HELLO, { label: 'w960', extension: 'webp' }),
      contentAddress(HELLO, { label: 'orig', extension: 'jpg' }),
      contentAddress(HELLO, { label: 'src', extension: 'mp3' }),
    ]) {
      expect(isAssetKey(key), `${key} is not an asset key`).toBe(true)
    }
  })

  it('refuses a key that would be a path traversal or another host', () => {
    for (const key of [
      '../../etc/passwd',
      '/etc/passwd',
      'aaaaaaaaaaaaaaaaaaaaaaaa/../x.webp',
      'aaaaaaaaaaaaaaaaaaaaaaaa.webp/../y.webp',
      'https://example.com/x.webp',
      '',
    ]) {
      expect(isAssetKey(key), `${key} was accepted as an asset key`).toBe(false)
    }
  })

  it('carries the same pattern the migration checks', () => {
    // The SQL literal, with its doubled backslash, as it appears in the file.
    expect(MIGRATION).toContain("'^[a-f0-9]{24}(?:-[a-z0-9]+)?\\.[a-z0-9]{2,5}$'")
  })
})

describe('the cache header', () => {
  it('is public, a year long, and immutable', () => {
    expect(ASSET_MAX_AGE_SECONDS).toBe(31_536_000)
    expect(ASSET_CACHE_CONTROL).toBe('public, max-age=31536000, immutable')
  })

  it('carries immutable, which is the directive that saves the round trip', () => {
    /*
     * Without it a browser still revalidates on an explicit reload and gets a
     * 304 with no body. The bytes are saved and the round trip is not, which on
     * a phone with 300ms of latency and 25 assets is most of the page's
     * perceived load time.
     */
    expect(ASSET_CACHE_CONTROL).toContain('immutable')
  })
})

describe('the ETag', () => {
  it('is the key, because the key is already the content', () => {
    const key = contentAddress(HELLO, { label: 'w960', extension: 'webp' })
    expect(assetETag(key)).toBe(`"${key}"`)
  })
})
