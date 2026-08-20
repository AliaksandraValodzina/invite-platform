/**
 * The in-route rate limit on replies.
 *
 * `20260819010600_rsvps.sql` is explicit that abuse control on this endpoint is
 * a rate limit in the route rather than a column in a table: "which does not
 * need to be written down in a table that outlives the party". This is that
 * limit, and it keeps that promise in two ways. It holds counters in memory,
 * so nothing survives the process. And what it holds is a **hash** of the
 * caller's address with a salt this process made at startup, so a heap dump, a
 * crash report or a log line has no address in it and no two deployments can
 * correlate their counters.
 *
 * What it is and is not. It is enough to stop a script from filling a buyer's
 * dashboard by hand, and it costs a real guest nothing, because nobody replies
 * to an invitation eight times in ten minutes. It is not a defence against a
 * distributed flood, and it does not survive a serverless instance being
 * recycled: the report's own answer for that is the platform's WAF rate
 * limiting, which is deployment configuration rather than code. Both are worth
 * having and this is the one that can exist before a deployment does.
 *
 * The clock and the store are arguments so a test can drive them. A limiter
 * tested by sleeping is a slow test that still cannot check the boundary.
 */

import { createHash, randomBytes } from 'node:crypto'

export const RSVP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000

/** Replies one caller may send per window, per invitation. */
export const RSVP_RATE_LIMIT_MAX = 8

export type RateLimitEntry = {
  /** Start of the window this count belongs to. */
  readonly startedAtMs: number
  readonly count: number
}

export type RateLimitStore = Map<string, RateLimitEntry>

export type RateLimitDecision =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly retryAfterSeconds: number }

/**
 * The process-wide store. Module level on purpose: it has to outlive a request
 * and must not outlive the process.
 */
const store: RateLimitStore = new Map()

/**
 * A per-process salt, so the hash cannot be reversed by trying every address in
 * a subnet. It is never persisted, which also means restarting forgets every
 * counter. That is the right trade for a control whose failure mode is "a
 * determined attacker sends nine replies instead of eight".
 */
const salt = randomBytes(16).toString('hex')

/**
 * The key one caller counts against, hashed.
 *
 * Per invitation as well as per caller, so one busy household replying to two
 * different weddings is not one budget, and so a flood against one event cannot
 * lock a guest out of another.
 */
export function rateLimitKey(callerAddress: string, slug: string): string {
  return createHash('sha256').update(`${salt}:${slug}:${callerAddress}`).digest('hex').slice(0, 32)
}

export function checkRateLimit(
  key: string,
  nowMs: number,
  options: {
    readonly store?: RateLimitStore
    readonly max?: number
    readonly windowMs?: number
  } = {}
): RateLimitDecision {
  const counters = options.store ?? store
  const max = options.max ?? RSVP_RATE_LIMIT_MAX
  const windowMs = options.windowMs ?? RSVP_RATE_LIMIT_WINDOW_MS

  sweep(counters, nowMs, windowMs)

  const existing = counters.get(key)

  if (existing === undefined || nowMs - existing.startedAtMs >= windowMs) {
    counters.set(key, { startedAtMs: nowMs, count: 1 })
    return { allowed: true, remaining: max - 1 }
  }

  if (existing.count >= max) {
    const retryAfterMs = existing.startedAtMs + windowMs - nowMs
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  }

  counters.set(key, { startedAtMs: existing.startedAtMs, count: existing.count + 1 })
  return { allowed: true, remaining: max - existing.count - 1 }
}

/**
 * Drops windows that have closed.
 *
 * Without this the map is a memory leak that grows with every distinct caller,
 * which on a page that goes round a large group chat is a real number. It runs
 * on the write path rather than on a timer because a timer in a serverless
 * function is a thing that may never fire.
 */
function sweep(counters: RateLimitStore, nowMs: number, windowMs: number): void {
  for (const [key, entry] of counters) {
    if (nowMs - entry.startedAtMs >= windowMs) counters.delete(key)
  }
}

/**
 * The caller's address, from the headers a proxy sets, or null when there is
 * nothing to go on.
 *
 * Null is not an error, and the caller skips the limit rather than substituting
 * a constant. Behind a proxy that strips these, every caller looks the same, so
 * one bucket would rate limit an entire wedding because of a header, and a limit
 * that fires on the twentieth guest is worse than no limit at all. The platform
 * WAF is the control for that case; this one needs an address to be worth
 * anything.
 */
export function callerAddress(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded !== null && forwarded.trim() !== '') {
    const first = forwarded.split(',')[0]?.trim()
    if (first !== undefined && first !== '') return first
  }
  const real = headers.get('x-real-ip')
  return real !== null && real.trim() !== '' ? real.trim() : null
}
