import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Reads a committed seed file the way a seeding script would: as bytes, then JSON.parse. */
export function readSeedFile(relativePath: string): unknown {
  const path = fileURLToPath(new URL(`../../../templates/${relativePath}`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8'))
}

export const CLASSIC_INVITATION = 'definitions/classic-invitation.json'

/** The placeholder themes committed with the template format in Phase 0.3. */
export const IVORY_THEME = 'themes/ivory.json'
export const MIDNIGHT_THEME = 'themes/midnight.json'

/**
 * The template line: the three design directions from
 * data/ip-design-directions/report.md, built as three themes rather than
 * narrowed to one.
 */
export const DECKLE_AND_DEBOSS_THEME = 'themes/deckle-and-deboss.json'
export const MASTHEAD_THEME = 'themes/masthead.json'
export const FOIL_AND_MIDNIGHT_THEME = 'themes/foil-and-midnight.json'

export const DESIGN_DIRECTION_THEMES = [
  ['Deckle & Deboss', DECKLE_AND_DEBOSS_THEME],
  ['Masthead', MASTHEAD_THEME],
  ['Foil & Midnight', FOIL_AND_MIDNIGHT_THEME],
] as const

export const ALL_THEMES = [
  ['ivory', IVORY_THEME],
  ['midnight', MIDNIGHT_THEME],
  ...DESIGN_DIRECTION_THEMES,
] as const
