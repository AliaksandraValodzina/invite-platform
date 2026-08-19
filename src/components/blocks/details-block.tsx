/**
 * The details list: what a guest needs to know, as label and value pairs.
 *
 * An item's value is either literal text the buyer wrote or a `source` naming a
 * field on the event row. The format has no expression language on purpose, so
 * this is the one place a date or a time is turned into words, and the details
 * list and the countdown therefore cannot disagree about when the event is.
 *
 * An item whose source has nothing behind it, which is an end time on an event
 * that has no end time, is dropped rather than rendered with an empty value.
 * A label with nothing after it looks like the page failed to load. If that
 * empties the list, the block renders nothing at all.
 */

import { formatEventDate, formatEventTime, type ResolvedSchedule } from '@/lib/event/time'
import type { DetailsConfig } from '@/lib/template'

import { BlockSection } from './block-section'
import { DetailIconGlyph } from './icons'

type DetailsItem = DetailsConfig['items'][number]

export function resolveDetailValue(item: DetailsItem, schedule: ResolvedSchedule): string | null {
  if (item.value !== undefined) return item.value

  switch (item.source) {
    case 'event-date':
      return formatEventDate(schedule.startsAtLocal)
    case 'event-start-time':
      return formatEventTime(schedule.startsAtLocal)
    case 'event-end-time':
      return schedule.endsAtLocal === null ? null : formatEventTime(schedule.endsAtLocal)
    case undefined:
      // The schema requires exactly one of value or source, so this is
      // unreachable for a validated config, and returning null rather than
      // throwing keeps that guarantee off the request path.
      return null
  }
}

export function DetailsBlock({
  blockId,
  config,
  schedule,
}: {
  readonly blockId: string
  readonly config: DetailsConfig
  readonly schedule: ResolvedSchedule
}) {
  const items = config.items
    .map((item) => ({ item, value: resolveDetailValue(item, schedule) }))
    .filter((entry): entry is { item: DetailsItem; value: string } => entry.value !== null)

  if (items.length === 0) return null

  const headingId = `${blockId}-heading`

  return (
    <BlockSection
      blockId={blockId}
      labelledBy={config.heading === undefined ? undefined : headingId}
    >
      {config.heading !== undefined && (
        <h2 id={headingId} className="type-title">
          {config.heading}
        </h2>
      )}

      <dl className="mt-[var(--space-lg)] grid gap-[var(--space-md)]">
        {items.map(({ item, value }, index) => (
          // Keyed by position because a label is not an identity: two items may
          // legitimately share one, and the list order is the template's.
          <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--space-sm)]">
            {item.icon !== undefined && (
              <DetailIconGlyph
                name={item.icon}
                className="row-span-2 mt-[var(--space-xs)] size-[var(--text-title-size)] text-[color:var(--color-accent)]"
              />
            )}
            <dt className="type-caption col-start-2 text-[color:var(--color-ink-muted)]">
              {item.label}
            </dt>
            <dd className="type-body col-start-2 break-words whitespace-pre-line">{value}</dd>
          </div>
        ))}
      </dl>
    </BlockSection>
  )
}
