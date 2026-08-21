import { describe, expect, it } from 'vitest'

import { assetUrl, isVendorHost, readAssetHostConfig, resolveAssetSrc } from '@/lib/uploads'

/**
 * The rule the storage decision came with, enforced rather than remembered.
 *
 * > the app only ever names a platform-owned hostname for assets, so the vendor
 * > stays swappable by DNS and no buyer's stored asset URL is ever a Cloudflare
 * > address.
 *
 * That is a sentence in a decision document, which is a claim. These are the
 * checks. The load bearing one is the last group: a bucket hostname pasted into
 * the environment variable is refused, because "we will remember not to do
 * that" is not a control and the mistake is available at 11pm to whoever is
 * getting the first deployment working.
 */

describe('with nothing configured', () => {
  it('serves assets from this app, which is a real path and not a stub', () => {
    const config = readAssetHostConfig({})
    expect(config.origin).toBeNull()
    expect(config.configured).toBe(false)
    expect(config.refused).toBeNull()
    expect(assetUrl('abcdef012345abcdef012345-w960.webp', config)).toBe(
      '/a/abcdef012345abcdef012345-w960.webp'
    )
  })

  it('treats an empty value the same as an absent one', () => {
    expect(readAssetHostConfig({ NEXT_PUBLIC_ASSET_HOST: '   ' }).origin).toBeNull()
  })
})

describe('with a platform hostname configured', () => {
  const config = readAssetHostConfig({ NEXT_PUBLIC_ASSET_HOST: 'https://assets.example.com/' })

  it('names that hostname and nothing else', () => {
    expect(config.origin).toBe('https://assets.example.com')
    expect(assetUrl('abcdef012345abcdef012345-w960.webp', config)).toBe(
      'https://assets.example.com/a/abcdef012345abcdef012345-w960.webp'
    )
  })

  it('resolves a stored app relative source onto it at render time', () => {
    /*
     * This is what keeps the vendor swappable. Documents and rows store
     * `/a/<key>`, which carries no hostname to become wrong later; the hostname
     * is applied here, on the way to a browser.
     */
    expect(resolveAssetSrc('/a/abcdef012345abcdef012345-w960.webp', config)).toBe(
      'https://assets.example.com/a/abcdef012345abcdef012345-w960.webp'
    )
  })

  it('leaves every other kind of source alone', () => {
    expect(resolveAssetSrc('/samples/unlicensed-placeholder/floral-band.jpg', config)).toBe(
      '/samples/unlicensed-placeholder/floral-band.jpg'
    )
    expect(resolveAssetSrc('https://images.example.org/photo.jpg', config)).toBe(
      'https://images.example.org/photo.jpg'
    )
  })
})

describe('a storage vendor hostname is refused', () => {
  const vendorValues = [
    'https://pub-1234.r2.dev',
    'https://abc123.r2.cloudflarestorage.com',
    'https://invitations.s3.eu-west-1.amazonaws.com',
    'https://storage.googleapis.com',
    'https://invitations.blob.core.windows.net',
  ]

  it('refuses each of them, and says why', () => {
    for (const value of vendorValues) {
      const config = readAssetHostConfig({ NEXT_PUBLIC_ASSET_HOST: value })
      expect(config.origin, `${value} was accepted`).toBeNull()
      expect(config.refused).toMatch(/storage vendor/)
      expect(config.refused).toMatch(/DNS/)
    }
  })

  it('recognises a vendor host by suffix rather than by exact match', () => {
    expect(isVendorHost('anything.r2.dev')).toBe(true)
    expect(isVendorHost('R2.DEV')).toBe(true)
    // And does not catch a platform hostname that merely contains the word.
    expect(isVendorHost('assets.myr2.example.com')).toBe(false)
    expect(isVendorHost('assets.example.com')).toBe(false)
  })
})

describe('a value that cannot serve assets safely is refused', () => {
  it('refuses http, because a guest page is https and an image is not an exception', () => {
    const config = readAssetHostConfig({ NEXT_PUBLIC_ASSET_HOST: 'http://assets.example.com' })
    expect(config.origin).toBeNull()
    expect(config.refused).toMatch(/https/)
  })

  it('refuses a bare hostname, which is the other thing people paste', () => {
    const config = readAssetHostConfig({ NEXT_PUBLIC_ASSET_HOST: 'assets.example.com' })
    expect(config.origin).toBeNull()
    expect(config.refused).toMatch(/absolute URL/)
  })

  it('never throws, so a build with a wrong value still builds and then says so', () => {
    expect(() => readAssetHostConfig({ NEXT_PUBLIC_ASSET_HOST: 'nonsense' })).not.toThrow()
  })
})
