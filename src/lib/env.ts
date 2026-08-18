/**
 * Config reading for Phase 0.1.
 *
 * There is no Supabase project and no Vercel link yet, so nothing here may throw
 * or fail a build when a variable is absent. Every read returns a defined value
 * and reports whether it came from the environment or from the fallback. When a
 * real service is wired up later, the strict checks belong in that service's own
 * module, not here.
 */

export type SiteConfig = {
  /** Absolute origin used for canonical and OG URLs. Never empty. */
  siteUrl: string
  /** True when siteUrl came from the environment rather than the fallback. */
  siteUrlConfigured: boolean
}

/** Used when NEXT_PUBLIC_SITE_URL is absent, so local and CI runs still resolve URLs. */
export const FALLBACK_SITE_URL = 'http://localhost:3000'

function normaliseOrigin(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null

  try {
    // Rejects values that are not absolute URLs, such as a bare host name.
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

/**
 * Reads site config from an environment-like record. Takes the record as an
 * argument so tests can exercise present, absent and malformed values without
 * mutating the real process environment.
 */
export function readSiteConfig(
  source: Record<string, string | undefined> = process.env
): SiteConfig {
  const raw = source.NEXT_PUBLIC_SITE_URL
  const origin = raw === undefined ? null : normaliseOrigin(raw)

  return {
    siteUrl: origin ?? FALLBACK_SITE_URL,
    siteUrlConfigured: origin !== null,
  }
}
