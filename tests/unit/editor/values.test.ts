/**
 * A submitted form in, an override out.
 *
 * The property the whole editor rests on is the last describe block: **a save
 * that changed nothing writes nothing**. Content is stored as overrides so that
 * a fix to a template's default copy reaches every event that did not override
 * it, and an editor that wrote the merged config back on every save would end
 * that quietly, on the first save, in a way nobody would notice until a typo
 * fix failed to arrive.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { overrideFor, pictureFields, readFields, readValue, type PictureValue } from '@/lib/editor'
import { BLOCK_CONFIG_SCHEMAS } from '@/lib/template'
import { contentPicture, text } from '@/lib/template/primitives'

const NOTHING = new Map<string, PictureValue | null>()

function form(entries: Record<string, string | string[]>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) formData.append(key, item)
  }
  return formData
}

const heroFields = readFields(BLOCK_CONFIG_SCHEMAS.hero)
const mapFields = readFields(BLOCK_CONFIG_SCHEMAS.map)
const countdownFields = readFields(BLOCK_CONFIG_SCHEMAS.countdown)
const detailsFields = readFields(BLOCK_CONFIG_SCHEMAS.details)

describe('reading a form', () => {
  it('takes each field by the name the schema gives it and ignores everything else', () => {
    const value = readValue(heroFields, {
      formData: form({
        'block:hero.headline': 'Wilhelmina & Bartholomew',
        'block:hero.eyebrow': 'Together with their families',
        // Not a field of this block, and not read. `strictObject` would refuse
        // it anyway; the point is that it never reaches the schema at all.
        'block:hero.mischief': 'hello',
      }),
      prefix: 'block:hero',
      current: {},
      pictures: NOTHING,
    })

    expect(value).toEqual({
      headline: 'Wilhelmina & Bartholomew',
      eyebrow: 'Together with their families',
    })
  })

  it('reads an empty box as absent, because absent and empty are one thing to a renderer', () => {
    const value = readValue(heroFields, {
      formData: form({ 'block:hero.headline': 'Only the names', 'block:hero.eyebrow': '' }),
      prefix: 'block:hero',
      current: { eyebrow: 'Was here' },
      pictures: NOTHING,
    })

    expect(value).toEqual({ headline: 'Only the names' })
  })

  it('reads an unticked box as false rather than as absent', () => {
    const fields = readFields(BLOCK_CONFIG_SCHEMAS['rsvp-form'])
    const value = readValue(fields, {
      formData: form({
        'block:rsvp.submitLabel': 'Send',
        'block:rsvp.successMessage': 'Thank you',
        'block:rsvp.closedMessage': 'Closed',
        'block:rsvp.guestCount.max': '6',
      }),
      prefix: 'block:rsvp',
      current: { guestCount: { enabled: true, max: 6 } },
      pictures: NOTHING,
    })

    expect(value.guestCount).toEqual({ enabled: false, max: 6 })
  })

  it('reads a set of ticked boxes as a list', () => {
    const value = readValue(countdownFields, {
      formData: form({
        'block:countdown.units': ['days', 'hours'],
        'block:countdown.passedMessage': 'Today is the day',
      }),
      prefix: 'block:countdown',
      current: {},
      pictures: NOTHING,
    })

    expect(value.units).toEqual(['days', 'hours'])
  })

  it('keeps a number a number, and hands back what was typed when it is not one', () => {
    const good = readValue(mapFields, {
      formData: form({
        'block:venue-map.venueName': 'The Orangery',
        'block:venue-map.address': '14 Orangery Lane',
        'block:venue-map.coordinates.lat': '-33.8',
        'block:venue-map.coordinates.lng': '151.29',
      }),
      prefix: 'block:venue-map',
      current: {},
      pictures: NOTHING,
    })
    expect(good.coordinates).toEqual({ lat: -33.8, lng: 151.29 })

    const bad = readValue(mapFields, {
      formData: form({
        'block:venue-map.venueName': 'The Orangery',
        'block:venue-map.address': '14 Orangery Lane',
        'block:venue-map.coordinates.lat': 'north-ish',
        'block:venue-map.coordinates.lng': '151.29',
      }),
      prefix: 'block:venue-map',
      current: {},
      pictures: NOTHING,
    })
    // Passed through rather than turned into NaN or dropped, so the schema is
    // what refuses it and the message names the field.
    expect(bad.coordinates).toEqual({ lat: 'north-ish', lng: 151.29 })
  })

  it('reads an optional group with every box empty as absent, which is how it is cleared', () => {
    const value = readValue(mapFields, {
      formData: form({
        'block:venue-map.venueName': 'The Orangery',
        'block:venue-map.address': '14 Orangery Lane',
        'block:venue-map.coordinates.lat': '',
        'block:venue-map.coordinates.lng': '',
      }),
      prefix: 'block:venue-map',
      current: { coordinates: { lat: -33.8, lng: 151.29 } },
      pictures: NOTHING,
    })

    expect(value.coordinates).toBeUndefined()
  })

  it('edits the rows a list already has and never adds or removes one', () => {
    const value = readValue(detailsFields, {
      formData: form({
        'block:event-details.items.0.label': 'When',
        'block:event-details.items.0.source': 'event-date',
        'block:event-details.items.1.label': 'Dress code',
        'block:event-details.items.1.value': 'Garden formal',
        // A third row nobody is offering. The reader asks for the rows the
        // stored value has, so this is never looked at.
        'block:event-details.items.2.label': 'Smuggled in',
        'block:event-details.items.2.value': 'nope',
      }),
      prefix: 'block:event-details',
      current: {
        items: [
          { label: 'When', source: 'event-date' },
          { label: 'Dress code', value: 'Black tie' },
        ],
      },
      pictures: NOTHING,
    })

    expect(value.items).toEqual([
      { label: 'When', source: 'event-date' },
      { label: 'Dress code', value: 'Garden formal' },
    ])
  })

  it('passes a field it has no control for through exactly as it was stored', () => {
    const schema = z.strictObject({ title: text(40), odd: z.date().optional() })
    const stored = new Date('2027-03-14T05:00:00.000Z')

    const value = readValue(readFields(schema), {
      formData: form({ 'block:x.title': 'Changed' }),
      prefix: 'block:x',
      current: { title: 'Was', odd: stored },
      pictures: NOTHING,
    })

    expect(value).toEqual({ title: 'Changed', odd: stored })
  })
})

describe('pictures', () => {
  const pictureSchema = z.strictObject({
    headline: text(60),
    photo: contentPicture('A photograph').optional(),
  })
  const pictureBlockFields = readFields(pictureSchema)

  const STORED = {
    src: '/a/aaaaaaaaaaaaaaaaaaaaaaaa-w480.webp',
    widths: [
      { src: '/a/aaaaaaaaaaaaaaaaaaaaaaaa-w480.webp', width: 480 },
      { src: '/a/aaaaaaaaaaaaaaaaaaaaaaaa-w960.webp', width: 960 },
    ],
    alt: 'The two of us',
  }

  it('finds every picture slot by walking the schema, not the form', () => {
    expect(pictureFields(pictureBlockFields, 'block:x', { photo: STORED })).toEqual([
      { name: 'block:x.photo', uploadKind: 'image' },
    ])
  })

  it('keeps the address a picture already had when nobody swapped it', () => {
    const value = readValue(pictureBlockFields, {
      formData: form({ 'block:x.headline': 'Us', 'block:x.photo.alt': 'Still the two of us' }),
      prefix: 'block:x',
      current: { photo: STORED },
      pictures: NOTHING,
    })

    expect(value.photo).toEqual({ ...STORED, alt: 'Still the two of us' })
  })

  it('replaces the address and every width together when one is swapped', () => {
    const swapped: PictureValue = {
      src: '/a/bbbbbbbbbbbbbbbbbbbbbbbb-w480.webp',
      widths: [{ src: '/a/bbbbbbbbbbbbbbbbbbbbbbbb-w480.webp', width: 480 }],
    }

    const value = readValue(pictureBlockFields, {
      formData: form({ 'block:x.headline': 'Us', 'block:x.photo.alt': 'The two of us' }),
      prefix: 'block:x',
      current: { photo: STORED },
      pictures: new Map([['block:x.photo', swapped]]),
    })

    // Both keys moved. A control that owned only `src` would have left the old
    // 960 in `widths`, and a laptop would still be served the old photograph.
    expect(value.photo).toEqual({ ...swapped, alt: 'The two of us' })
  })

  it('removes the picture when the box says so', () => {
    const value = readValue(pictureBlockFields, {
      formData: form({ 'block:x.headline': 'Us' }),
      prefix: 'block:x',
      current: { photo: STORED },
      pictures: new Map([['block:x.photo', null]]),
    })

    expect(value.photo).toBeUndefined()
  })
})

describe('turning a config into an override', () => {
  it('keeps only what differs from the template', () => {
    const base = { eyebrow: 'Together with their families', headline: 'Sarah & Tom' }
    const next = { eyebrow: 'Together with their families', headline: 'Wilhelmina & Bartholomew' }

    expect(overrideFor(base, next)).toEqual({ headline: 'Wilhelmina & Bartholomew' })
  })

  it('writes null for a field the template fills in and the buyer emptied', () => {
    const base = { eyebrow: 'Together with their families', headline: 'Sarah & Tom' }
    const next = { headline: 'Sarah & Tom' }

    // null is the only way to say "clear this" through a merge that is a key
    // replace. See applyOverride in src/lib/template/resolve.ts.
    expect(overrideFor(base, next)).toEqual({ eyebrow: null })
  })

  it('writes nothing for a field neither the template nor the buyer has', () => {
    expect(overrideFor({ headline: 'Sarah & Tom' }, { headline: 'Sarah & Tom' })).toEqual({})
  })

  it('writes a nested object whole, because that is how the merge replaces it', () => {
    const base = { guestCount: { enabled: true, label: 'How many?', max: 6 } }
    const next = { guestCount: { enabled: true, label: 'How many?', max: 4 } }

    expect(overrideFor(base, next)).toEqual({
      guestCount: { enabled: true, label: 'How many?', max: 4 },
    })
  })

  it('leaves a list alone when only its order of keys would have differed', () => {
    const base = { items: [{ label: 'When', source: 'event-date' }] }
    const next = { items: [{ source: 'event-date', label: 'When' }] }

    expect(overrideFor(base, next)).toEqual({})
  })
})

describe('a save that changed nothing', () => {
  /**
   * The round trip that matters. Every field of a block is rendered from the
   * template's own config, submitted back untouched, and the override that comes
   * out has to be empty. If it is not, every event stops tracking fixes to its
   * template's default copy on the first time its buyer opens the editor and
   * presses save without typing anything.
   */
  it.each([
    ['hero', BLOCK_CONFIG_SCHEMAS.hero, { eyebrow: 'Together', headline: 'Sarah & Tom' }],
    [
      'map',
      BLOCK_CONFIG_SCHEMAS.map,
      {
        heading: 'Where',
        venueName: 'The Boathouse',
        address: '1 Marine Parade',
        directionsUrl: 'https://maps.example.com/?q=boathouse',
        coordinates: { lat: -33.8006, lng: 151.2938 },
        note: 'On the lawn.',
      },
    ],
    [
      'countdown',
      BLOCK_CONFIG_SCHEMAS.countdown,
      { heading: 'Counting down', units: ['days', 'hours'], passedMessage: 'Today is the day' },
    ],
    [
      'details',
      BLOCK_CONFIG_SCHEMAS.details,
      {
        heading: 'The day',
        items: [
          { icon: 'calendar', label: 'When', source: 'event-date' },
          { icon: 'gift', label: 'Gifts', value: 'Your presence is plenty.' },
        ],
      },
    ],
    [
      'rsvp-form',
      BLOCK_CONFIG_SCHEMAS['rsvp-form'],
      {
        heading: 'Will you be there?',
        intro: 'One reply per invitation.',
        submitLabel: 'Send RSVP',
        successMessage: 'Thank you.',
        closedMessage: 'Replies are closed.',
        deadlineNote: 'Please reply by 1 February.',
        guestCount: { enabled: true, label: 'How many of you?', max: 6 },
      },
    ],
  ])('writes an empty override for an untouched %s', (_name, schema, config) => {
    const fields = readFields(schema)
    const submitted = submitUnchanged(fields, 'block:x', config as Record<string, unknown>)

    const value = readValue(fields, {
      formData: submitted,
      prefix: 'block:x',
      current: config as Record<string, unknown>,
      pictures: NOTHING,
    })

    expect(overrideFor(config as Record<string, unknown>, value)).toEqual({})
  })
})

/**
 * The form a browser would send if a buyer opened the editor and changed
 * nothing: every control filled from the current value, exactly as
 * `SectionFields` renders it.
 */
function submitUnchanged(
  fields: ReturnType<typeof readFields>,
  prefix: string,
  value: Record<string, unknown>,
  path: readonly (string | number)[] = [],
  into: FormData = new FormData()
): FormData {
  for (const field of fields) {
    const at = [...path, field.key]
    const name = [prefix, ...at].join('.')
    const current = value[field.key]
    const control = field.control

    if (control.kind === 'toggle') {
      if (current === true) into.set(name, 'yes')
      continue
    }

    if (control.kind === 'choices') {
      for (const item of Array.isArray(current) ? current : []) into.append(name, String(item))
      continue
    }

    if (control.kind === 'group' || control.kind === 'picture') {
      const inner = control.kind === 'group' ? control.fields : control.fields
      submitUnchanged(inner, prefix, (current ?? {}) as Record<string, unknown>, at, into)
      continue
    }

    if (control.kind === 'rows') {
      const rows = Array.isArray(current) ? current : []
      rows.forEach((row, index) => {
        submitUnchanged(
          control.fields,
          prefix,
          row as Record<string, unknown>,
          [...at, index],
          into
        )
      })
      continue
    }

    if (control.kind === 'opaque') continue

    into.set(name, current === undefined ? '' : String(current))
  }

  return into
}

/**
 * Kept honest: the helper above has to cover every control kind the shipped
 * block set can produce, nested ones included. Without walking into groups,
 * pictures and rows this assertion would quietly stop covering `number` and
 * `toggle`, which are the two kinds that only appear inside something.
 */
it('the unchanged-form helper knows every control kind the block set produces', () => {
  const kinds = new Set<string>()

  const collect = (fields: ReturnType<typeof readFields>): void => {
    for (const field of fields) {
      kinds.add(field.control.kind)
      const control = field.control
      if (control.kind === 'group' || control.kind === 'rows' || control.kind === 'picture') {
        collect(control.fields)
      }
    }
  }

  for (const schema of Object.values(BLOCK_CONFIG_SCHEMAS)) collect(readFields(schema))

  expect([...kinds].sort()).toEqual([
    'choice',
    'choices',
    'group',
    'line',
    'number',
    'paragraph',
    'picture',
    'rows',
    'toggle',
    'url',
  ])
})
