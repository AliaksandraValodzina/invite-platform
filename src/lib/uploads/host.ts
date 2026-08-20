/**
 * The one place that turns an object key into something a browser can fetch.
 *
 * The captain's storage decision (2026-08-20, `decision-storage-provider.md`)
 * came with a consequence that outlives the provider choice itself:
 *
 * > the app only ever names a platform-owned hostname for assets, so the vendor
 * > stays swappable by DNS and no buyer's stored asset URL is ever a Cloudflare
 * > address.
 *
 * Two things enforce that, and neither is a convention anybody has to remember.
 *
 * **Nothing stores a URL.** `public.uploads` holds keys. A URL is built here,
 * at render time, from the key and the deployment's configured hostname. If a
 * URL were stored, moving off R2 would mean rewriting every row and every
 * buyer's saved document, which is the definition of a vendor lock nobody
 * planned. Template content that names an upload names it as `/a/<key>`, which
 * `imageSourceSchema` already accepts as an app served path, and this module
 * resolves that to the asset hostname when one is configured.
 *
 * **A vendor hostname is refused.** `readAssetHostConfig` rejects an origin
 * that belongs to an object storage vendor rather than to the platform, so a
 * deployment cannot be configured into the exact state the decision forbids by
 * somebody pasting a bucket URL into an environment variable at 11pm. It is a
 * short list and it is not a security control: it is a guard against the
 * plausible mistake, which is the one that actually happens.
 *
 * Absent configuration, assets are same origin: `/a/<key>` served by this app.
 * That is what makes everything here run and be tested with no cloud credential
 * present, and it is a real serving path rather than a stub, so the cache
 * headers a test reads off the wire locally are the ones the code sets.
 */

import { ASSET_PATH_PREFIX } from './address'

export type AssetHostConfig = {
  /**
   * Absolute origin assets are served from, or null for same origin.
   *
   * Null is the local and preview case and is not a degraded one: the app
   * serves the bytes itself at `/a/<key>` with the same headers.
   */
  readonly origin: string | null
  /** True when the origin came from the environment rather than the fallback. */
  readonly configured: boolean
  /** Set when a value was present and refused, so a deploy can say why. */
  readonly refused: string | null
}

/**
 * Hostname suffixes that belong to a storage vendor rather than to us.
 *
 * `r2.dev` and `r2.cloudflarestorage.com` are the two shapes a Cloudflare R2
 * bucket is reachable at before a custom hostname is attached, and they are
 * exactly what somebody pastes in to "just get it working". The AWS and Google
 * equivalents are here because the same mistake is available on the day this
 * moves, and the rule is about the platform naming its own hostname rather
 * than about Cloudflare specifically.
 */
export const VENDOR_HOST_SUFFIXES = [
  'r2.dev',
  'r2.cloudflarestorage.com',
  'cloudflarestorage.com',
  'amazonaws.com',
  'storage.googleapis.com',
  'blob.core.windows.net',
] as const

export function isVendorHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return VENDOR_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`))
}

/**
 * Reads the asset host, or explains why it was refused.
 *
 * It never throws, for the same reason `src/lib/env.ts` never throws: a build
 * on a machine with no variables set has to succeed. A refusal becomes a null
 * origin plus a reason, and the ingest path is what turns that into a loud
 * failure at the moment somebody actually tries to store bytes.
 */
export function readAssetHostConfig(
  source: Record<string, string | undefined> = process.env
): AssetHostConfig {
  const raw = (source.NEXT_PUBLIC_ASSET_HOST ?? '').trim()
  if (raw === '') return { origin: null, configured: false, refused: null }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return {
      origin: null,
      configured: false,
      refused: `NEXT_PUBLIC_ASSET_HOST must be an absolute URL such as https://assets.example.com, got "${raw}"`,
    }
  }

  if (url.protocol !== 'https:') {
    return {
      origin: null,
      configured: false,
      refused: `NEXT_PUBLIC_ASSET_HOST must use https, got "${url.protocol}"`,
    }
  }

  if (isVendorHost(url.hostname)) {
    return {
      origin: null,
      configured: false,
      refused:
        `NEXT_PUBLIC_ASSET_HOST is "${url.hostname}", which belongs to a storage vendor. ` +
        'Assets are served from a hostname the platform owns, pointed at the bucket by DNS, ' +
        'so that changing provider is a DNS change and not a rewrite of every stored asset ' +
        'URL. See data/ip-product-plan/decision-storage-provider.md.',
    }
  }

  return { origin: url.origin, configured: true, refused: null }
}

/**
 * Where a browser fetches this object.
 *
 * Relative when no asset host is configured, which keeps a local run and a
 * preview deployment on one code path rather than on a stub.
 */
export function assetUrl(key: string, config: AssetHostConfig = readAssetHostConfig()): string {
  const path = `${ASSET_PATH_PREFIX}${key}`
  return config.origin === null ? path : `${config.origin}${path}`
}

/**
 * Resolves a stored image source for rendering.
 *
 * A document that names an upload names it as `/a/<key>`, and that is the form
 * that gets stored, because it carries no hostname to become wrong later. This
 * turns it into the configured asset host at render time and leaves every other
 * kind of source alone: a bundled sample under `/samples/` is still served by
 * this app, and an absolute https URL is already somebody's decision.
 */
export function resolveAssetSrc(
  src: string,
  config: AssetHostConfig = readAssetHostConfig()
): string {
  if (!src.startsWith(ASSET_PATH_PREFIX)) return src
  return assetUrl(src.slice(ASSET_PATH_PREFIX.length), config)
}
