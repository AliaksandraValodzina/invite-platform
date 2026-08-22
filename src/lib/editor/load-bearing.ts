/**
 * Which details a guest has already acted on, and what changing one means.
 *
 * The captain's answer 5, and it is not optional: before saving a change that
 * touches `events.starts_at_local`, `events.time_zone`, or the map block's
 * `venueName` or `address`, count the replies and, if there are any, show the
 * count and require confirmation. Nothing is sent to guests. It is a
 * confirmation and never a block.
 *
 * ## Why this is a list and not something read out of the format
 *
 * Everything else the editor draws is derived from a block's own Zod schema, so
 * a sixth block type gets a form with nobody touching the editor
 * (docs/editing.md). This cannot be, and the reason is worth stating rather
 * than apologising for: a schema says what a field is shaped like, and nothing
 * about it can say that somebody has already booked a flight around the answer.
 * That is a fact about people, not about types.
 *
 * So it is a list. It is data rather than a chain of conditions, so adding "the
 * dress code once invitations have gone out" later is one line here and no
 * change anywhere else.
 *
 * ## Comparison is on the value a guest would have read
 *
 * Not on the override. A buyer who deletes their override for a venue name has
 * not left the venue alone: the page falls back to the template's default and
 * the address on screen changes. So the comparison is between the merged
 * config before and the merged config after, which is what a guest sees.
 */

import type { DetailChange } from './result'
import type { JsonRecord } from './values'

/**
 * The block config fields a guest plans a journey around, by block type.
 *
 * `map` is the only entry today, and the two fields are the captain's own.
 */
export const LOAD_BEARING_BLOCK_FIELDS: Readonly<Record<string, readonly string[]>> = {
  map: ['venueName', 'address'],
}

/** What each field is called on the confirmation, so it reads as a sentence. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  venueName: 'The venue',
  address: 'The address',
}

export function loadBearingFieldsFor(blockType: string): readonly string[] {
  return Object.hasOwn(LOAD_BEARING_BLOCK_FIELDS, blockType)
    ? (LOAD_BEARING_BLOCK_FIELDS[blockType] as readonly string[])
    : []
}

/** True when this block type has any field worth asking about. */
export function isLoadBearingBlock(blockType: string): boolean {
  return loadBearingFieldsFor(blockType).length > 0
}

/**
 * The load bearing differences between what a guest can read now and what a
 * save would make it say.
 *
 * `before` and `after` are merged configs, not overrides. A field that was
 * absent and is now absent is not a change; a field that was absent and now has
 * a value is, because the page said something and will now say something else.
 */
export function blockDetailChanges(
  blockType: string,
  before: JsonRecord,
  after: JsonRecord
): readonly DetailChange[] {
  const changes: DetailChange[] = []

  for (const field of loadBearingFieldsFor(blockType)) {
    const from = asText(before[field])
    const to = asText(after[field])
    if (from === to) continue

    changes.push({
      label: FIELD_LABELS[field] ?? field,
      from: from === '' ? 'nothing' : from,
      to: to === '' ? 'nothing' : to,
    })
  }

  return changes
}

/**
 * The same question for the event row's own two columns.
 *
 * The date and the time zone are one entry between them when both move, because
 * to a buyer they are one fact: "Saturday at 3pm in Melbourne" is the thing a
 * guest wrote in a diary, and reporting a time zone change as a separate line
 * would read as two changes to something that only happened once.
 */
export function scheduleDetailChanges(
  before: { readonly startsAtLocal: string; readonly timeZone: string },
  after: { readonly startsAtLocal: string; readonly timeZone: string },
  describe: (startsAtLocal: string, timeZone: string) => string
): readonly DetailChange[] {
  if (before.startsAtLocal === after.startsAtLocal && before.timeZone === after.timeZone) {
    return []
  }

  return [
    {
      label: 'The date and time',
      from: describe(before.startsAtLocal, before.timeZone),
      to: describe(after.startsAtLocal, after.timeZone),
    },
  ]
}

/**
 * A stored value as the line of text a confirmation quotes.
 *
 * Only strings and numbers are quoted. A picture or a list is not a field on
 * this list and never will be, because "the venue moved" is a sentence and a
 * changed photograph is not a thing to hold somebody up over.
 *
 * Line endings are normalised, and that is the one subtle part. HTML form
 * submission sends every newline in a textarea as CRLF, and an address stored
 * with bare newlines therefore comes back "changed" the first time a buyer
 * saves anything at all on that form. The confirmation would then say the
 * address changes from an address to the identical address, on a page whose
 * whole job is to be believed. What a guest reads is the same either way, so
 * for this comparison it is the same address.
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\r\n/g, '\n').trim()
  if (typeof value === 'number') return String(value)
  return ''
}
