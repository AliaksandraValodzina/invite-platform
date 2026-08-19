import { themePipeline, type ThemeTokens } from '@/lib/template'

import { IVORY_THEME, MIDNIGHT_THEME, readSeedFile } from '../template/seed-files'

/**
 * The OG card is tested against the themes the repo actually ships, not against
 * tokens invented in a test file. If a seed theme changes in a way the card
 * cannot survive, these tests are where it shows up.
 */
function loadTokens(relativePath: string): ThemeTokens {
  const outcome = themePipeline.load(readSeedFile(relativePath))
  if (!outcome.ok) {
    throw new Error(`${relativePath} is not a valid theme: ${outcome.message}`)
  }
  return outcome.document.tokens
}

export const IVORY_TOKENS = loadTokens(IVORY_THEME)
export const MIDNIGHT_TOKENS = loadTokens(MIDNIGHT_THEME)

export const SEED_THEMES: readonly (readonly [string, ThemeTokens])[] = [
  ['ivory', IVORY_TOKENS],
  ['midnight', MIDNIGHT_TOKENS],
]

/** The longest title the events table will accept, per its char_length check. */
export const MAX_TITLE_LENGTH = 160

export const LONG_TITLE = 'Alexandra Konstantinopoulos & Christopher Featherstonehaugh'

export const SAMPLE_EVENT = {
  title: 'Emma & Jake',
  startsAtLocal: '2027-03-14T16:00:00',
  kicker: 'You are invited',
  venue: 'The Grounds of Alexandria, Sydney',
  footer: 'invite.example/e/emma-and-jake',
} as const
