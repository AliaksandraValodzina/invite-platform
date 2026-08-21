/**
 * The claim this file exists to make good on:
 *
 *   a block type nobody wrote a form for gets a form.
 *
 * So most of it is tested against `futureBlockSchema`, a block type that does
 * not exist in this product and never will. If the editor had a table of block
 * types in it somewhere, or a special case for the hero, none of these would
 * pass. The real block set is checked at the end, as the other half of the same
 * claim: what the format actually ships has to come out right too.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { PARAGRAPH_MIN_LENGTH, humanise, readFields, type Field } from '@/lib/editor'
import { BLOCK_CONFIG_SCHEMAS } from '@/lib/template'
import {
  contentPicture,
  decorativePicture,
  httpsUrlSchema,
  optionalText,
  text,
} from '@/lib/template/primitives'

/**
 * A sixth block type, invented here and added to nothing. It uses every shape
 * the format has: text at both lengths, a URL, a number, a boolean, a closed
 * choice, a list of choices, a list of objects, a nested object, and both kinds
 * of picture.
 */
const futureBlockSchema = z.strictObject({
  title: text(60, 'What it is called'),
  blurb: optionalText(400),
  bookingUrl: httpsUrlSchema.optional(),
  seats: z.number().int().min(1).max(200),
  showSeats: z.boolean(),
  mood: z.enum(['calm', 'loud']).optional(),
  days: z
    .array(z.enum(['friday', 'saturday']))
    .min(1)
    .max(2),
  people: z.array(z.strictObject({ name: text(40), role: optionalText(40) })).min(1),
  bounds: z.strictObject({ north: z.number(), south: z.number() }).optional(),
  photo: contentPicture('A photograph').optional(),
  banner: decorativePicture('A banner', 'envelope').optional(),
})

function fieldFor(fields: readonly Field[], key: string): Field {
  const field = fields.find((candidate) => candidate.key === key)
  if (field === undefined) throw new Error(`no field ${key} in ${fields.map((f) => f.key).join()}`)
  return field
}

describe('a block type the editor has never seen', () => {
  const fields = readFields(futureBlockSchema)

  it('gets one field per key, in the order the schema declares them', () => {
    expect(fields.map((field) => field.key)).toEqual([
      'title',
      'blurb',
      'bookingUrl',
      'seats',
      'showSeats',
      'mood',
      'days',
      'people',
      'bounds',
      'photo',
      'banner',
    ])
  })

  it('knows which fields are required, from the schema and not from a list', () => {
    expect(fieldFor(fields, 'title').required).toBe(true)
    expect(fieldFor(fields, 'blurb').required).toBe(false)
  })

  it('gives one line to short text and a box to long text', () => {
    expect(fieldFor(fields, 'title').control).toEqual({ kind: 'line', maxLength: 60 })
    expect(fieldFor(fields, 'blurb').control).toEqual({ kind: 'paragraph', maxLength: 400 })
  })

  it('takes the paragraph threshold from the ceiling the format declares', () => {
    const justUnder = readFields(z.strictObject({ a: text(PARAGRAPH_MIN_LENGTH - 1) }))
    const exactly = readFields(z.strictObject({ a: text(PARAGRAPH_MIN_LENGTH) }))

    expect(justUnder[0]?.control.kind).toBe('line')
    expect(exactly[0]?.control.kind).toBe('paragraph')
  })

  it('reads a URL as a URL, which is metadata the schema carries', () => {
    expect(fieldFor(fields, 'bookingUrl').control).toEqual({ kind: 'url', maxLength: 2048 })
  })

  it('carries a number with its bounds', () => {
    expect(fieldFor(fields, 'seats').control).toEqual({
      kind: 'number',
      integer: true,
      minimum: 1,
      maximum: 200,
    })
  })

  it('reads a boolean as a toggle and a closed set as a choice', () => {
    expect(fieldFor(fields, 'showSeats').control).toEqual({ kind: 'toggle' })
    expect(fieldFor(fields, 'mood').control).toEqual({ kind: 'choice', values: ['calm', 'loud'] })
  })

  it('reads a list of choices as a set to tick, with its bounds', () => {
    expect(fieldFor(fields, 'days').control).toEqual({
      kind: 'choices',
      values: ['friday', 'saturday'],
      minItems: 1,
      maxItems: 2,
    })
  })

  it('reads a list of objects as rows, with the fields of one row', () => {
    const control = fieldFor(fields, 'people').control
    expect(control.kind).toBe('rows')
    if (control.kind !== 'rows') return
    expect(control.fields.map((field) => field.key)).toEqual(['name', 'role'])
  })

  it('reads a nested object as a group', () => {
    const control = fieldFor(fields, 'bounds').control
    expect(control.kind).toBe('group')
    if (control.kind !== 'group') return
    expect(control.fields.map((field) => field.key)).toEqual(['north', 'south'])
  })

  /*
   * The picture is the one control that owns more than one key, and the reason
   * is in src/lib/template/primitives.ts: swapping a picture changes its address
   * and its stored widths together, so a control that owned only `src` would
   * leave a srcset pointing at the picture that was just replaced.
   */
  it('takes src and widths off a picture, and leaves everything else as fields', () => {
    const photo = fieldFor(fields, 'photo').control
    expect(photo.kind).toBe('picture')
    if (photo.kind !== 'picture') return

    expect(photo.fields.map((field) => field.key)).toEqual(['alt'])
    expect(photo.uploadKind).toBe('image')
  })

  it('reads the upload kind the slot declares, so a cover is stored as a cover', () => {
    const banner = fieldFor(fields, 'banner').control
    expect(banner.kind).toBe('picture')
    if (banner.kind !== 'picture') return

    expect(banner.fields).toEqual([])
    expect(banner.uploadKind).toBe('envelope')
  })

  it('does not throw on a field JSON Schema cannot describe, it gives up on that one', () => {
    // A date is a real Zod type and one JSON Schema has no word for, so the
    // conversion writes an empty node for it. The point is the failure mode:
    // one field with no control, not a form that will not render. What is
    // stored for it is passed through untouched on save, which
    // tests/unit/editor/values.test.ts asserts.
    const fields = readFields(z.strictObject({ ok: text(10), odd: z.date() }))

    expect(fields.map((field) => field.key)).toEqual(['ok', 'odd'])
    expect(fieldFor(fields, 'odd').control).toEqual({ kind: 'opaque' })
  })
})

describe('labels', () => {
  it('uses the words the schema carries when it carries any', () => {
    expect(fieldFor(readFields(futureBlockSchema), 'title').label).toBe('What it is called')
  })

  it('falls back to the key, so a field nobody labelled still gets a form', () => {
    expect(fieldFor(readFields(futureBlockSchema), 'bookingUrl').label).toBe('Booking url')
  })

  it.each([
    ['venueName', 'Venue name'],
    ['passedMessage', 'Passed message'],
    ['lat', 'Lat'],
    ['submit-label', 'Submit label'],
  ])('turns %s into %s', (key, expected) => {
    expect(humanise(key)).toBe(expected)
  })
})

describe('the block set that actually ships', () => {
  it.each(Object.keys(BLOCK_CONFIG_SCHEMAS))('gives %s a control for every field', (type) => {
    const schema = BLOCK_CONFIG_SCHEMAS[type as keyof typeof BLOCK_CONFIG_SCHEMAS]
    const fields = readFields(schema)

    expect(fields.length).toBeGreaterThan(0)
    /*
     * Nothing in the shipped set should be opaque. An opaque field is the
     * editor admitting it has no control, which is the right answer for a shape
     * nobody has thought about and the wrong one for a block this repo owns.
     */
    expect(fields.filter((field) => field.control.kind === 'opaque')).toEqual([])
  })

  it('never offers a control for a picture address, in any block', () => {
    for (const schema of Object.values(BLOCK_CONFIG_SCHEMAS)) {
      for (const field of readFields(schema)) {
        if (field.control.kind !== 'picture') continue
        expect(field.control.fields.map((inner) => inner.key)).not.toContain('src')
        expect(field.control.fields.map((inner) => inner.key)).not.toContain('widths')
      }
    }
  })
})
