/**
 * The themes the card can be rendered in today.
 *
 * These are the seed theme files the repo already ships, validated through the
 * same pipeline the guest page will use, not a palette invented for the card.
 * The three design directions in the scout report have not been chosen from
 * yet, so `ivory` is the neutral placeholder and `midnight` is here because a
 * dark card in a dark chat bubble is the case most likely to break.
 *
 * This module is the seam. When the event read path lands, the guest page will
 * pass tokens resolved from `templates.theme` and `event_content.theme`
 * straight to `planOgCard`, and nothing else about the card changes.
 */

import { themePipeline, type ThemeTokens } from '@/lib/template'

import ivory from '../../../templates/themes/ivory.json'
import midnight from '../../../templates/themes/midnight.json'
import { OG_THEME_KEYS, type OgThemeKey } from './share'

export const DEFAULT_OG_THEME: OgThemeKey = 'ivory'

function load(key: OgThemeKey, document: unknown): ThemeTokens {
  const outcome = themePipeline.load(document)
  if (!outcome.ok) {
    // At module load, not per request. A seed theme that does not validate is a
    // broken deploy, and the unit suite fails on it before this ever runs.
    throw new Error(`the ${key} seed theme is not a valid theme document: ${outcome.message}`)
  }
  return outcome.document.tokens
}

const TOKENS: Readonly<Record<OgThemeKey, ThemeTokens>> = {
  ivory: load('ivory', ivory),
  midnight: load('midnight', midnight),
}

export function ogThemeTokens(key: OgThemeKey = DEFAULT_OG_THEME): ThemeTokens {
  return TOKENS[key]
}

export { OG_THEME_KEYS }
