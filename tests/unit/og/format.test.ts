import { describe, expect, it } from 'vitest'

import { formatEventWhen } from '@/lib/og'

/**
 * The card prints a wall clock. `events.starts_at_local` already IS the wall
 * clock, so the only correct thing to do with it is read the components and
 * format them. Every bug in this area comes from routing that string through an
 * instant on the way to the screen.
 */
describe('formatEventWhen', () => {
  it('prints the stored wall clock', () => {
    expect(formatEventWhen('2027-03-14T16:00:00')).toEqual({
      date: 'Sunday 14 March 2027',
      time: '4:00 pm',
      line: 'Sunday 14 March 2027 · 4:00 pm',
    })
  })

  it('does not shift across a DST boundary, in either direction', () => {
    // 2027-04-04 02:30 does not exist once in Sydney: the clocks go back, so
    // that wall clock happens twice. 2026-10-04 02:30 does not exist at all,
    // because the clocks go forward. A card that resolved the string to an
    // instant would print a different time for at least one of these.
    expect(formatEventWhen('2027-04-04T02:30:00').time).toBe('2:30 am')
    expect(formatEventWhen('2026-10-04T02:30:00').time).toBe('2:30 am')
  })

  it('prints midnight and noon the way a person reads them', () => {
    expect(formatEventWhen('2027-03-14T00:00:00').time).toBe('12:00 am')
    expect(formatEventWhen('2027-03-14T12:00:00').time).toBe('12:00 pm')
  })

  it('uses ordinary spaces, so the string a test asserts is the string rendered', () => {
    // Newer ICU puts a narrow no break space before the meridiem. It is
    // invisible in a diff and it is not what satori has a glyph for.
    const { line } = formatEventWhen('2027-03-14T16:00:00')
    expect(line).not.toMatch(/[\u202f\u00a0]/)
  })

  it('rejects anything that is not a stored local timestamp', () => {
    expect(() => formatEventWhen('2027-03-14')).toThrow(/local timestamp/i)
    expect(() => formatEventWhen('2027-03-14T16:00:00Z')).toThrow(/local timestamp/i)
    expect(() => formatEventWhen('not a date')).toThrow(/local timestamp/i)
    expect(() => formatEventWhen('2027-13-40T16:00:00')).toThrow(/local timestamp/i)
  })

  it('accepts the seconds-and-microseconds form Postgres hands back', () => {
    expect(formatEventWhen('2027-03-14T16:00:00.123456').time).toBe('4:00 pm')
  })
})
