/**
 * Per block schema rules. Every case here is a document the format has to
 * refuse, and each one is written so that removing the rule from the schema
 * makes the test fail.
 */

import { describe, expect, it } from 'vitest'

import {
  BLOCK_CONFIG_SCHEMAS,
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  countdownConfigSchema,
  detailsConfigSchema,
  findRetiredBlocks,
  heroConfigSchema,
  isAuthorable,
  isBlockType,
  mapConfigSchema,
  rsvpFormConfigSchema,
  templateDefinitionPipeline,
} from '@/lib/template'

import { CLASSIC_INVITATION, readSeedFile } from './seed-files'

function messagesFrom(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? []
}

describe('hero', () => {
  const valid = { headline: 'Sarah & Tom' }

  it('accepts the smallest useful hero', () => {
    expect(heroConfigSchema.parse(valid)).toEqual(valid)
  })

  it('rejects an unknown key rather than ignoring it', () => {
    // Strict, so a typo in a guided form is an error the buyer can see rather
    // than a field that silently does nothing.
    const result = heroConfigSchema.safeParse({ ...valid, headine: 'typo' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty headline, because an empty element is not a design', () => {
    expect(heroConfigSchema.safeParse({ headline: '   ' }).success).toBe(false)
  })

  it('requires alt text whenever there is an image', () => {
    const result = heroConfigSchema.safeParse({
      ...valid,
      image: { src: 'https://cdn.example.com/a.jpg' },
    })
    expect(result.success).toBe(false)
  })

  it.each([
    ['javascript:alert(1)', 'must use https, got "javascript:"'],
    ['http://cdn.example.com/a.jpg', 'must use https, got "http:"'],
    ['/uploads/a.jpg', 'must be an absolute URL'],
  ])('rejects the image src %s', (src, expectedMessage) => {
    const result = heroConfigSchema.safeParse({ ...valid, image: { src, alt: 'A photo' } })

    expect(result.success).toBe(false)
    expect(messagesFrom(result)).toContain(expectedMessage)
  })

  describe('artwork', () => {
    it('takes a path to a file the app serves, which is where the template line keeps its own', () => {
      const config = { ...valid, artwork: { src: '/samples/floral-band.jpg' } }
      expect(heroConfigSchema.parse(config)).toEqual(config)
    })

    it('takes an https URL too, for artwork a buyer uploads to a host', () => {
      const config = { ...valid, artwork: { src: 'https://cdn.example.com/band.webp' } }
      expect(heroConfigSchema.parse(config)).toEqual(config)
    })

    it('has nowhere to put alt text, because it is decoration and the block draws alt=""', () => {
      // The rule this holds: nothing decorative is ever described to a screen
      // reader, so nobody is ever asked to transcribe words baked into a
      // picture. An alt key here would be an invitation to do exactly that.
      const result = heroConfigSchema.safeParse({
        ...valid,
        artwork: { src: '/samples/floral-band.jpg', alt: 'Watercolour florals' },
      })

      expect(result.success).toBe(false)
    })

    it.each([
      ['javascript:alert(1)', 'must use https, got "javascript:"'],
      ['http://cdn.example.com/band.jpg', 'must use https, got "http:"'],
      ['data:image/png;base64,iVBORw0KGgo=', 'must use https, got "data:"'],
      // A browser reads this as another host entirely, which is the whole point
      // of keeping app served artwork to paths.
      [
        '//evil.example.com/band.jpg',
        'must not start with "//", which a browser reads as another host',
      ],
      ['/samples/../../etc/passwd.png', 'must not contain a ".." segment'],
    ])('rejects the artwork src %s', (src, expectedMessage) => {
      const result = heroConfigSchema.safeParse({ ...valid, artwork: { src } })

      expect(result.success).toBe(false)
      expect(messagesFrom(result)).toContain(expectedMessage)
    })

    it.each([
      // An SVG served from our own origin is same origin with the guest page,
      // and an SVG is a document that can carry script.
      ['/samples/band.svg'],
      ['/samples/band'],
      ['/samples/band.js'],
      ['relative/band.jpg'],
    ])('rejects the artwork src %s as not a picture this app serves', (src) => {
      expect(heroConfigSchema.safeParse({ ...valid, artwork: { src } }).success).toBe(false)
    })
  })
})

describe('details', () => {
  it('requires exactly one of value or source on an item', () => {
    const both = detailsConfigSchema.safeParse({
      items: [{ label: 'When', value: '14 March', source: 'event-date' }],
    })
    const neither = detailsConfigSchema.safeParse({ items: [{ label: 'When' }] })

    expect(both.success).toBe(false)
    expect(messagesFrom(both)).toContain('provide exactly one of value or source')
    expect(neither.success).toBe(false)
    expect(messagesFrom(neither)).toContain('provide exactly one of value or source')
  })

  it('accepts a source from the closed set and rejects anything else', () => {
    expect(
      detailsConfigSchema.safeParse({ items: [{ label: 'When', source: 'event-date' }] }).success
    ).toBe(true)

    // No expression language. A source names a field on the event row or it is
    // not a source.
    expect(
      detailsConfigSchema.safeParse({ items: [{ label: 'When', source: '{{event.date}}' }] })
        .success
    ).toBe(false)
  })

  it('rejects an empty item list', () => {
    expect(detailsConfigSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('rejects an icon that is not in the bundled set', () => {
    const result = detailsConfigSchema.safeParse({
      items: [{ icon: 'https://evil.example.com/x.svg', label: 'When', value: 'Soon' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('countdown', () => {
  const valid = { units: ['days', 'hours'], passedMessage: 'Today is the day.' }

  it('accepts a subset of the units', () => {
    expect(countdownConfigSchema.parse(valid)).toEqual(valid)
  })

  it('rejects a repeated unit', () => {
    const result = countdownConfigSchema.safeParse({ ...valid, units: ['days', 'days'] })

    expect(result.success).toBe(false)
    expect(messagesFrom(result)).toContain('units must not repeat')
  })

  it('rejects no units at all', () => {
    expect(countdownConfigSchema.safeParse({ ...valid, units: [] }).success).toBe(false)
  })

  it('has nowhere to put a date, because the event row owns it', () => {
    // If this ever passes, there are two answers to "when is the wedding" and
    // the time zone rule stops being enforceable in one place.
    const result = countdownConfigSchema.safeParse({
      ...valid,
      target: '2026-03-14T15:00:00+11:00',
    })
    expect(result.success).toBe(false)
  })
})

describe('map', () => {
  const valid = { venueName: 'The Boathouse', address: '1 Marine Parade, Manly NSW 2095' }

  it('accepts a venue with no link and no coordinates', () => {
    expect(mapConfigSchema.parse(valid)).toEqual(valid)
  })

  it('rejects coordinates outside the earth', () => {
    expect(
      mapConfigSchema.safeParse({ ...valid, coordinates: { lat: -91, lng: 151 } }).success
    ).toBe(false)
  })

  it('rejects a directions link that is not https', () => {
    const result = mapConfigSchema.safeParse({ ...valid, directionsUrl: 'javascript:alert(1)' })

    expect(result.success).toBe(false)
    expect(messagesFrom(result)).toContain('must use https, got "javascript:"')
  })
})

describe('rsvp-form', () => {
  const valid = {
    submitLabel: 'Send RSVP',
    successMessage: 'Thank you.',
    closedMessage: 'RSVPs are closed.',
    fields: {
      email: { enabled: true },
      guestCount: { enabled: true, max: 4 },
      dietary: { enabled: true },
      message: { enabled: false },
    },
  }

  it('accepts the four known questions as toggles', () => {
    expect(rsvpFormConfigSchema.parse(valid)).toEqual(valid)
  })

  it('cannot express a custom question, so it cannot become a question builder', () => {
    // fields is a record of the four known questions, not a list. This is a
    // scope control and a privacy control at the same time: the format cannot
    // introduce guest PII that the retention rules on rsvps do not cover.
    const asList = rsvpFormConfigSchema.safeParse({
      ...valid,
      fields: [{ key: 'shoe-size', label: 'Shoe size', type: 'text' }],
    })
    const extraQuestion = rsvpFormConfigSchema.safeParse({
      ...valid,
      fields: { ...valid.fields, shoeSize: { enabled: true } },
    })

    expect(asList.success).toBe(false)
    expect(extraQuestion.success).toBe(false)
  })

  it('requires a closed message, because the grace period needs something to say', () => {
    const { closedMessage: _closedMessage, ...withoutClosed } = valid
    expect(rsvpFormConfigSchema.safeParse(withoutClosed).success).toBe(false)
  })

  it('caps the guest count, so a party of 900 cannot be submitted', () => {
    expect(
      rsvpFormConfigSchema.safeParse({
        ...valid,
        fields: { ...valid.fields, guestCount: { enabled: true, max: 900 } },
      }).success
    ).toBe(false)
  })
})

describe('the registry', () => {
  it('has an entry for every schema and a schema for every entry', () => {
    // Adding a schema without registry metadata, or the reverse, is the way a
    // block ends up half added. This is the assertion that catches it.
    expect(Object.keys(BLOCK_REGISTRY).sort()).toEqual(Object.keys(BLOCK_CONFIG_SCHEMAS).sort())

    for (const type of BLOCK_TYPES) {
      expect(BLOCK_REGISTRY[type].type).toBe(type)
      expect(BLOCK_REGISTRY[type].addedIn).toBe(1)
    }
  })

  it('is the five v1 blocks and nothing else', () => {
    expect([...BLOCK_TYPES].sort()).toEqual(['countdown', 'details', 'hero', 'map', 'rsvp-form'])
  })

  it('reports every v1 block as authorable', () => {
    expect(BLOCK_TYPES.filter((type) => !isAuthorable(type))).toEqual([])
  })

  it('recognises known types and refuses unknown ones', () => {
    expect(isBlockType('hero')).toBe(true)
    expect(isBlockType('gallery')).toBe(false)
    // Object.hasOwn, not `in`, so a prototype key is not a block type.
    expect(isBlockType('toString')).toBe(false)
  })
})

describe('retiring a block, which is step one of removing one', () => {
  const definition = templateDefinitionPipeline.parse(readSeedFile(CLASSIC_INVITATION))

  it('finds nothing while every block is active', () => {
    expect(findRetiredBlocks(definition, BLOCK_REGISTRY)).toEqual([])
  })

  it('still validates a document containing a retired block', () => {
    // The point of retiring rather than deleting: a schema stays so that
    // documents already in the database keep loading. Retiring changes what may
    // be authored, and changes nothing about what already exists.
    const retiredRegistry = {
      ...BLOCK_REGISTRY,
      countdown: { ...BLOCK_REGISTRY.countdown, status: 'retired' as const, retiredIn: 2 },
    }

    expect(templateDefinitionPipeline.load(readSeedFile(CLASSIC_INVITATION)).ok).toBe(true)
    expect(findRetiredBlocks(definition, retiredRegistry)).toEqual([
      { id: 'countdown', type: 'countdown' },
    ])
  })
})
