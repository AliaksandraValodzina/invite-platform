import { describe, expect, it } from 'vitest'

import {
  LOAD_BEARING_BLOCK_FIELDS,
  blockDetailChanges,
  isLoadBearingBlock,
  loadBearingFieldsFor,
  scheduleDetailChanges,
} from '@/lib/editor/load-bearing'
import {
  CONFIRM_FIELD,
  CONFIRM_REPLAY_FIELD,
  confirming,
  encodeReplay,
  isConfirmed,
  replayedForm,
} from '@/lib/editor/result'

/**
 * The captain's answer 5, as assertions.
 *
 * The rule: before saving a change that touches `events.starts_at_local`,
 * `events.time_zone`, or the map block's `venueName` or `address`, count the
 * replies and, if any exist, show the count and require confirmation. Nothing is
 * sent to guests. It is a confirmation, not a block.
 *
 * The list is asserted directly, not merely exercised. A quiet change to it is
 * a change to a product promise, and it should be somebody deleting a line of a
 * test rather than a green build.
 */

describe('which details are load bearing', () => {
  it('is the map block, and its venue and address', () => {
    expect(LOAD_BEARING_BLOCK_FIELDS).toEqual({ map: ['venueName', 'address'] })
  })

  it('says no to every other block type, so the rest of the form saves at once', () => {
    for (const type of ['hero', 'details', 'countdown', 'rsvp-form', 'envelope']) {
      expect(isLoadBearingBlock(type), type).toBe(false)
      expect(loadBearingFieldsFor(type)).toEqual([])
    }
  })

  it('says no to a block type nobody has invented yet', () => {
    // The default has to be "save it", because the confirmation is a claim
    // about people having acted on a fact and no new block makes that claim
    // until somebody decides it does.
    expect(isLoadBearingBlock('gallery')).toBe(false)
  })
})

describe('a change to the venue', () => {
  const before = { heading: 'Where', venueName: 'The Old Hall', address: '1 Long Lane' }

  it('is reported with what it said and what it will say', () => {
    const changes = blockDetailChanges('map', before, { ...before, venueName: 'The New Hall' })

    expect(changes).toEqual([{ label: 'The venue', from: 'The Old Hall', to: 'The New Hall' }])
  })

  it('reports both fields when both move', () => {
    const changes = blockDetailChanges('map', before, {
      ...before,
      venueName: 'The New Hall',
      address: '2 Short Street',
    })

    expect(changes.map((change) => change.label)).toEqual(['The venue', 'The address'])
  })

  it('is not reported when the words are the same', () => {
    expect(blockDetailChanges('map', before, { ...before, heading: 'Getting there' })).toEqual([])
  })

  it('ignores whitespace, so a stray space is not a venue move', () => {
    expect(blockDetailChanges('map', before, { ...before, venueName: ' The Old Hall ' })).toEqual(
      []
    )
  })

  it('ignores the line endings a form posts back, which are not the ones it was given', () => {
    /*
     * A textarea posts every newline as CRLF, so a stored address with bare
     * newlines comes back "changed" the first time a buyer saves anything on
     * that form. Without this the confirmation says the address changes from an
     * address to the identical address, on the one page that has to be believed.
     */
    const stored = { ...before, address: '14 Orangery Lane\nAshgrove NSW 2000' }
    const posted = { ...before, address: '14 Orangery Lane\r\nAshgrove NSW 2000' }

    expect(blockDetailChanges('map', stored, posted)).toEqual([])
  })

  it('counts clearing a field, because the page then says something else', () => {
    /*
     * Compared on the merged config a guest reads, not on the override. A buyer
     * who deletes their venue name has not left the venue alone: the page falls
     * back to the template's default.
     */
    const changes = blockDetailChanges('map', before, { ...before, venueName: '' })

    expect(changes).toEqual([{ label: 'The venue', from: 'The Old Hall', to: 'nothing' }])
  })

  it('does not look at fields of a block type that is not on the list', () => {
    expect(blockDetailChanges('hero', before, { ...before, venueName: 'Anywhere' })).toEqual([])
  })
})

describe('a change to when it is', () => {
  const before = { startsAtLocal: '2027-03-14T16:00:00', timeZone: 'Australia/Sydney' }
  const describe_ = (startsAtLocal: string, timeZone: string) => `${startsAtLocal} ${timeZone}`

  it('reports a moved date', () => {
    const changes = scheduleDetailChanges(
      before,
      { ...before, startsAtLocal: '2027-03-15T16:00:00' },
      describe_
    )

    expect(changes).toEqual([
      {
        label: 'The date and time',
        from: '2027-03-14T16:00:00 Australia/Sydney',
        to: '2027-03-15T16:00:00 Australia/Sydney',
      },
    ])
  })

  it('reports a moved time zone, which moves the event without moving the clock', () => {
    const changes = scheduleDetailChanges(
      before,
      { ...before, timeZone: 'Australia/Perth' },
      describe_
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]?.to).toContain('Australia/Perth')
  })

  it('reports one change when both move, because to a buyer it is one fact', () => {
    const changes = scheduleDetailChanges(
      before,
      { startsAtLocal: '2027-04-01T18:00:00', timeZone: 'Europe/London' },
      describe_
    )

    expect(changes).toHaveLength(1)
  })

  it('reports nothing when neither moves', () => {
    expect(scheduleDetailChanges(before, { ...before }, describe_)).toEqual([])
  })
})

describe('what the buyer is told', () => {
  const change = { label: 'The venue', from: 'The Old Hall', to: 'The New Hall' }

  it('names the count, in the singular when it is one', () => {
    const result = confirming(1, [change], '')

    expect(result.status).toBe('confirm')
    expect(result.status === 'confirm' && result.message).toContain('1 person has')
  })

  it('names the count in the plural, and says nothing is sent to guests', () => {
    const result = confirming(12, [change], '')

    expect(result.status === 'confirm' && result.message).toContain('12 people have')
    expect(result.status === 'confirm' && result.message).toContain('Nothing is sent')
  })

  it('does not say zero when the count could not be read', () => {
    // Null is not zero. Saying "0 people have already replied" while asking
    // somebody to confirm a change because people have replied is nonsense.
    const result = confirming(null, [change], '')

    expect(result.status === 'confirm' && result.message).not.toContain('0 people')
    expect(result.status === 'confirm' && result.message).toContain('could not check')
  })
})

describe('the pending save surviving the question', () => {
  function form(entries: readonly [string, string][]): FormData {
    const formData = new FormData()
    for (const [name, value] of entries) formData.append(name, value)
    return formData
  }

  it('replays exactly what was submitted, including a field asked twice', () => {
    const submitted = form([
      ['title', 'Wilhelmina & Bartholomew'],
      ['block:venue-map.venueName', 'The New Hall'],
      ['ask:one', 'yes'],
      ['ask:two', 'yes'],
    ])

    const confirmed = form([
      [CONFIRM_FIELD, 'yes'],
      [CONFIRM_REPLAY_FIELD, encodeReplay(submitted)],
      // The visible controls, reset by React to what was stored. They must lose.
      ['title', 'Your invitation'],
      ['block:venue-map.venueName', 'The Old Hall'],
    ])

    const replayed = replayedForm(confirmed)

    expect(replayed.get('title')).toBe('Wilhelmina & Bartholomew')
    expect(replayed.get('block:venue-map.venueName')).toBe('The New Hall')
    expect(replayed.getAll('ask:one')).toEqual(['yes'])
    expect(replayed.getAll('ask:two')).toEqual(['yes'])
  })

  it('preserves an unticked checkbox by leaving it absent', () => {
    const submitted = form([['ask:one', 'yes']])
    const replayed = replayedForm(
      form([
        [CONFIRM_FIELD, 'yes'],
        [CONFIRM_REPLAY_FIELD, encodeReplay(submitted)],
      ])
    )

    expect(replayed.has('ask:one')).toBe(true)
    expect(replayed.has('ask:two')).toBe(false)
  })

  it('does not carry the confirmation plumbing into the replay', () => {
    const encoded = encodeReplay(
      form([
        [CONFIRM_FIELD, 'yes'],
        [CONFIRM_REPLAY_FIELD, 'title=old'],
        ['title', 'new'],
      ])
    )

    expect(encoded).toBe('title=new')
  })

  it('does not carry React own server action fields either', () => {
    // They arrive in the FormData a form action is handed, and they are the
    // previous request's routing information: an action id, a key, the bound
    // arguments. Replaying them is carrying a stale envelope inside a letter.
    const encoded = encodeReplay(
      form([
        ['$ACTION_REF_4', ''],
        ['$ACTION_KEY', 'k680fb6de'],
        ['$ACTION_4:1', '["an-event-id",{"status":"idle"}]'],
        ['title', 'new'],
      ])
    )

    expect(encoded).toBe('title=new')
  })

  it('uses the submitted form when this is not a confirmation', () => {
    const plain = form([['title', 'typed just now']])

    expect(replayedForm(plain).get('title')).toBe('typed just now')
    expect(isConfirmed(plain)).toBe(false)
  })

  it('uses the submitted form when the confirmation carries no replay', () => {
    const empty = form([
      [CONFIRM_FIELD, 'yes'],
      ['title', 'typed just now'],
    ])

    expect(replayedForm(empty).get('title')).toBe('typed just now')
    expect(isConfirmed(empty)).toBe(true)
  })
})
