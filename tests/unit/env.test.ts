import { describe, expect, it } from 'vitest'

import { FALLBACK_SITE_URL, readSiteConfig } from '@/lib/env'

describe('readSiteConfig', () => {
  it('uses the configured origin when NEXT_PUBLIC_SITE_URL is set', () => {
    const config = readSiteConfig({ NEXT_PUBLIC_SITE_URL: 'https://invites.example.com' })

    expect(config.siteUrl).toBe('https://invites.example.com')
    expect(config.siteUrlConfigured).toBe(true)
  })

  it('drops a path and keeps only the origin', () => {
    const config = readSiteConfig({ NEXT_PUBLIC_SITE_URL: 'https://invites.example.com/e/wedding' })

    expect(config.siteUrl).toBe('https://invites.example.com')
  })

  it('falls back without throwing when the variable is absent', () => {
    const config = readSiteConfig({})

    expect(config.siteUrl).toBe(FALLBACK_SITE_URL)
    expect(config.siteUrlConfigured).toBe(false)
  })

  it('falls back when the variable is set but empty', () => {
    const config = readSiteConfig({ NEXT_PUBLIC_SITE_URL: '   ' })

    expect(config.siteUrl).toBe(FALLBACK_SITE_URL)
    expect(config.siteUrlConfigured).toBe(false)
  })

  it('falls back when the value is not an absolute URL', () => {
    const config = readSiteConfig({ NEXT_PUBLIC_SITE_URL: 'invites.example.com' })

    expect(config.siteUrl).toBe(FALLBACK_SITE_URL)
    expect(config.siteUrlConfigured).toBe(false)
  })
})
