/**
 * Somewhere to put bytes, behind one interface, chosen by configuration.
 *
 * The captain approved Cloudflare R2 behind a platform owned hostname. The
 * hosted environments do not exist yet and no R2 credential exists locally, so
 * the rule this repo already follows applies: the real service sits behind an
 * interface, is selected by configuration, and is inert when absent. That is
 * the same shape as `src/lib/supabase/service.ts`, which throws on first use
 * rather than at import so that a build with no variables still succeeds.
 *
 * Four operations, and nothing else. `put`, `get`, `delete`, `has`. There is
 * deliberately no `list`, no `copy` and no signed URL minting in the interface:
 * every one of those would be a capability the app does not need and a shape
 * the next store has to implement.
 *
 * **Selection.** With every R2 variable present, R2. Otherwise the local
 * filesystem, rooted at a directory this repo ignores. A local fallback is a
 * real store rather than a stub, which is what lets the whole capability, its
 * cache headers and its deletion sweep be exercised with no cloud credential.
 *
 * **The fallback is not allowed to be silent in a deployment.** A silent
 * fallback is exactly the failure this repo keeps refusing: a deployment that
 * serves assets from a CDN in front of an empty bucket, where every upload
 * appears to work and every guest gets a broken image. So the rule is a pair:
 * if a deployment names an asset hostname, it must have a real store behind it,
 * and `assertStoreIsUsable` refuses the upload rather than writing bytes to a
 * function's ephemeral disk.
 */

import 'server-only'

import { readAssetHostConfig } from '../host'

import { filesystemStore } from './filesystem'
import { memoryStore } from './memory'
import { r2Store, readR2Config, type R2Config } from './r2'

export type StoredObject = {
  readonly key: string
  readonly contentType: string
  readonly bytes: Uint8Array
}

export interface ObjectStore {
  /** Names the driver, for a log line and for a test that asserts which one ran. */
  readonly driver: 'memory' | 'filesystem' | 'r2'
  /**
   * Writes bytes at a key.
   *
   * Overwriting is a no-op by construction rather than by contract: keys are
   * content addressed, so the bytes already there are the bytes being written.
   */
  put(object: StoredObject): Promise<void>
  get(key: string): Promise<StoredObject | null>
  /** True when the object was there and is now gone. */
  delete(key: string): Promise<boolean>
  has(key: string): Promise<boolean>
}

export type StoreSelection =
  | { readonly driver: 'r2'; readonly config: R2Config }
  | { readonly driver: 'filesystem'; readonly root: string }
  | { readonly driver: 'memory' }

/** Where the filesystem store writes when nothing says otherwise. Git ignored. */
export const DEFAULT_LOCAL_ROOT = '.uploads'

export function selectStore(
  source: Record<string, string | undefined> = process.env
): StoreSelection {
  const forced = (source.UPLOADS_DRIVER ?? '').trim()
  const r2 = readR2Config(source)

  if (forced === 'memory') return { driver: 'memory' }
  if (forced === 'filesystem') return { driver: 'filesystem', root: localRoot(source) }
  if (forced === 'r2') {
    if (r2 === null) {
      throw new Error(
        'UPLOADS_DRIVER is "r2" but the R2 variables are not all set. ' +
          'Unset UPLOADS_DRIVER to fall back to the local store, or set every one of ' +
          'R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.'
      )
    }
    return { driver: 'r2', config: r2 }
  }

  if (forced !== '') {
    throw new Error(`UPLOADS_DRIVER must be memory, filesystem or r2, got "${forced}"`)
  }

  if (r2 !== null) return { driver: 'r2', config: r2 }
  return { driver: 'filesystem', root: localRoot(source) }
}

function localRoot(source: Record<string, string | undefined>): string {
  const value = (source.UPLOADS_LOCAL_ROOT ?? '').trim()
  return value === '' ? DEFAULT_LOCAL_ROOT : value
}

/**
 * The pairing rule, checked before anything is written.
 *
 * A deployment that names an asset hostname has a CDN in front of a bucket. If
 * the selected store is local, the bytes go to a function's disk that the CDN
 * cannot see and that vanishes with the instance, and every symptom of that is
 * downstream and confusing: uploads succeed, rows appear, guests get broken
 * images. Refusing here turns it into one sentence at the moment somebody
 * presses upload.
 */
export function assertStoreIsUsable(
  selection: StoreSelection,
  source: Record<string, string | undefined> = process.env
): void {
  const host = readAssetHostConfig(source)

  if (host.refused !== null) throw new Error(host.refused)

  if (host.configured && selection.driver !== 'r2') {
    throw new Error(
      `NEXT_PUBLIC_ASSET_HOST names an asset hostname, but the selected object store is ` +
        `"${selection.driver}". A hostname in front of a store the deployment cannot write to ` +
        'means every upload succeeds and every guest gets a broken image. Set the R2 variables, ' +
        'or unset NEXT_PUBLIC_ASSET_HOST to serve assets from this app.'
    )
  }
}

/**
 * The store this process uses, built once.
 *
 * Once, because the memory driver is only a store at all if everybody shares
 * one, and because the filesystem driver should not re-check its root on every
 * object.
 */
let cached: ObjectStore | null = null

export function objectStore(source: Record<string, string | undefined> = process.env): ObjectStore {
  if (cached !== null) return cached

  const selection = selectStore(source)
  assertStoreIsUsable(selection, source)
  cached = buildStore(selection)
  return cached
}

export function buildStore(selection: StoreSelection): ObjectStore {
  switch (selection.driver) {
    case 'memory':
      return memoryStore()
    case 'filesystem':
      return filesystemStore(selection.root)
    case 'r2':
      return r2Store(selection.config)
  }
}

/** For tests, which need a fresh store between cases. */
export function resetObjectStore(): void {
  cached = null
}

export { memoryStore } from './memory'
export { filesystemStore } from './filesystem'
export { r2Store, readR2Config, type R2Config } from './r2'
