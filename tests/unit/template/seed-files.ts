import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Reads a committed seed file the way a seeding script would: as bytes, then JSON.parse. */
export function readSeedFile(relativePath: string): unknown {
  const path = fileURLToPath(new URL(`../../../templates/${relativePath}`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8'))
}

export const CLASSIC_INVITATION = 'definitions/classic-invitation.json'
export const IVORY_THEME = 'themes/ivory.json'
export const MIDNIGHT_THEME = 'themes/midnight.json'
