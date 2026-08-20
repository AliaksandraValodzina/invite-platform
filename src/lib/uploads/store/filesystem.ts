/**
 * An object store in a directory.
 *
 * This is what runs locally and in CI, and it is a real store rather than a
 * stand-in: the browser suite uploads through the API route, fetches the URL
 * that comes back, reads the cache headers off the wire and reloads to prove
 * the browser did not go to the network again. None of that would be worth
 * anything against a stub.
 *
 * The content type is stored beside the bytes rather than guessed from the
 * extension on the way out. The extension is decoration on a content address;
 * the type is what the sniffer decided, and guessing it a second time in a
 * different place is how the two answers come to differ.
 *
 * Keys are checked against the key pattern before they touch a path. A key
 * arrives from a database column, so this is not the first line of defence, but
 * `..` in a value that gets joined onto a root directory is worth refusing at
 * the point of use rather than trusting three layers up.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { isAssetKey } from '../address'

import type { ObjectStore } from './index'

export function filesystemStore(root: string): ObjectStore {
  const base = resolve(root)

  return {
    driver: 'filesystem',

    async put(object) {
      const path = pathFor(base, object.key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, object.bytes)
      await writeFile(`${path}.type`, object.contentType, 'utf8')
    },

    async get(key) {
      const path = pathFor(base, key)
      let bytes: Buffer
      try {
        bytes = await readFile(path)
      } catch {
        return null
      }

      let contentType = 'application/octet-stream'
      try {
        contentType = (await readFile(`${path}.type`, 'utf8')).trim()
      } catch {
        /* an object written before the type file, which only a hand edit does */
      }

      return { key, contentType, bytes: new Uint8Array(bytes) }
    },

    async delete(key) {
      const path = pathFor(base, key)
      try {
        await readFile(path)
      } catch {
        return false
      }
      await rm(path, { force: true })
      await rm(`${path}.type`, { force: true })
      return true
    },

    async has(key) {
      try {
        await readFile(pathFor(base, key))
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * Two characters of the hash become a directory.
 *
 * A flat directory of a hundred thousand files is slow to list and unpleasant
 * to look at, and the first two characters of a sha256 are evenly distributed
 * by construction, so this is free.
 */
function pathFor(base: string, key: string): string {
  if (!isAssetKey(key)) {
    throw new Error(`"${key}" is not a content address, so it is not a path in the object store`)
  }
  return join(base, key.slice(0, 2), key)
}
