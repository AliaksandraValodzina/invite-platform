'use client'

/**
 * The countdown.
 *
 * It counts to an instant that was resolved once, on the server, from
 * `events.starts_at_local` and `events.time_zone`. Nothing about a zone reaches
 * this component: the guest's own clock is the only clock it reads, and the
 * difference between two instants is the same number in every zone. That is
 * what makes the countdown correct for a guest in London reading about a
 * wedding in Sydney, and correct across a DST change in either place.
 *
 * The first client render uses the `nowMs` the server rendered with, not
 * `Date.now()`, so hydration matches exactly rather than being patched over
 * with a suppressed warning. The browser's own clock is only picked up once
 * React subscribes, which is the first moment there is one worth reading.
 *
 * There is no live region. A countdown that announced itself every second would
 * make the page unusable with a screen reader, so the ticking digits are inert
 * and the section is named by its heading.
 */

import { useSyncExternalStore } from 'react'

import { countdownTo, type CountdownUnit } from '@/lib/event/time'
import type { CountdownConfig } from '@/lib/template'

import { BlockSection } from './block-section'

/**
 * Unit names are the block set's copy, not the buyer's. The format stores unit
 * keys rather than labels so that a template cannot ship a countdown whose
 * labels disagree with what it is counting.
 */
const UNIT_LABELS: Readonly<Record<CountdownUnit, { one: string; many: string }>> = {
  days: { one: 'day', many: 'days' },
  hours: { one: 'hour', many: 'hours' },
  minutes: { one: 'minute', many: 'minutes' },
  seconds: { one: 'second', many: 'seconds' },
}

/** A second, because the smallest unit a template can ask for is a second. */
const TICK_MS = 1_000

/**
 * The browser clock, as an external store rather than as state in an effect.
 *
 * The clock genuinely is an external system, and modelling it as one is what
 * lets the first client render use the server's `nowMs` (through
 * `getServerSnapshot`) and hydrate byte for byte, then pick up the real time as
 * soon as React subscribes. State set inside an effect would render twice and
 * would still have to explain away a hydration mismatch.
 *
 * One interval for the page, however many countdown blocks a template has.
 */
const clockListeners = new Set<() => void>()
let clockNow = 0
let clockTimer: ReturnType<typeof setInterval> | null = null

function subscribeToClock(listener: () => void): () => void {
  clockListeners.add(listener)

  if (clockTimer === null) {
    clockNow = Date.now()
    clockTimer = setInterval(() => {
      clockNow = Date.now()
      for (const notify of clockListeners) notify()
    }, TICK_MS)
  }

  return () => {
    clockListeners.delete(listener)
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer)
      clockTimer = null
    }
  }
}

/**
 * Cached rather than reading the clock on every call, because
 * `useSyncExternalStore` compares snapshots and a snapshot that is different
 * every time it is asked for is an infinite render loop. The lazy fill covers a
 * client side navigation, where the first read happens before the subscribe.
 */
function readClock(): number {
  if (clockNow === 0) clockNow = Date.now()
  return clockNow
}

export function CountdownBlock({
  blockId,
  config,
  targetMs,
  nowMs,
}: {
  readonly blockId: string
  readonly config: CountdownConfig
  /** The event start, already resolved from the local pair on the server. */
  readonly targetMs: number
  /** The server's clock at render time. Also the first client render's clock. */
  readonly nowMs: number
}) {
  const now = useSyncExternalStore(subscribeToClock, readClock, () => nowMs)

  const { passed, parts } = countdownTo(targetMs, now, config.units)
  const headingId = `${blockId}-heading`

  return (
    <BlockSection
      blockId={blockId}
      labelledBy={config.heading === undefined ? undefined : headingId}
      className="text-center"
    >
      {config.heading !== undefined && (
        <h2 id={headingId} className="type-title">
          {config.heading}
        </h2>
      )}

      {passed ? (
        <p data-testid="countdown-passed" className="type-title mt-[var(--space-md)]">
          {config.passedMessage}
        </p>
      ) : (
        <div
          data-testid="countdown-units"
          className="mt-[var(--space-lg)] grid auto-cols-fr grid-flow-col gap-[var(--space-sm)]"
        >
          {parts.map((part) => (
            <div key={part.unit} data-unit={part.unit}>
              <div className="type-title tabular-nums">{part.value}</div>
              <div className="type-caption text-[color:var(--color-ink-muted)]">
                {part.value === 1 ? UNIT_LABELS[part.unit].one : UNIT_LABELS[part.unit].many}
              </div>
            </div>
          ))}
        </div>
      )}
    </BlockSection>
  )
}
