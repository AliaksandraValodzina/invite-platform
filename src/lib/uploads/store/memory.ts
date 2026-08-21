/**
 * An object store in a Map.
 *
 * For unit tests, and for nothing else. It exists so the ingest path, the
 * limits, the re-encoder and the deletion sweep can all be exercised without a
 * filesystem or a network, which is what keeps that suite fast enough to run on
 * every save.
 */

import type { ObjectStore, StoredObject } from './index'

export function memoryStore(): ObjectStore {
  const objects = new Map<string, StoredObject>()

  return {
    driver: 'memory',

    async put(object) {
      // Copied, because the caller's buffer may be a view onto a pooled
      // allocation that gets reused. A store that hands back bytes somebody
      // else has since overwritten is a bug that only shows up under load.
      objects.set(object.key, { ...object, bytes: Uint8Array.from(object.bytes) })
    },

    async get(key) {
      const found = objects.get(key)
      return found === undefined ? null : { ...found, bytes: Uint8Array.from(found.bytes) }
    },

    async delete(key) {
      return objects.delete(key)
    },

    async has(key) {
      return objects.has(key)
    },
  }
}
