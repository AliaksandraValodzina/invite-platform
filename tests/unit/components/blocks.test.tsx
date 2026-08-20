/**
 * The block set, rendered to markup.
 *
 * These run against the committed seed definition rather than hand written
 * config objects, so the thing under test is the template that will actually be
 * seeded. Rendering is done with `react-dom/server`, which needs no DOM and no
 * extra dependency, and which is also how a guest page will be produced.
 *
 * Assertions read values. "The countdown renders" is not a claim worth making:
 * the claims here are that it renders 2 days and 3 hours for a `now` two days
 * and three hours before the wedding, and that a details item shows the date off
 * the event row rather than a second copy of it.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  BlockList,
  HeroBlock,
  renderBlock,
  type BlockContext,
  type RsvpSubmitResult,
} from '@/components/blocks'
import { ThemeScope } from '@/components/theme-scope'
import { resolveEventSchedule, type ResolvedSchedule } from '@/lib/event/time'
import type { RsvpQuestion } from '@/lib/rsvp/questions'
import {
  BLOCK_TYPES,
  templateDefinitionPipeline,
  themePipeline,
  type BlockType,
  type TemplateBlock,
} from '@/lib/template'

import {
  CLASSIC_INVITATION,
  IVORY_THEME,
  MIDNIGHT_THEME,
  readSeedFile,
} from '../template/seed-files'

const definition = templateDefinitionPipeline.parse(readSeedFile(CLASSIC_INVITATION))

const SYDNEY_SCHEDULE = { startsAtLocal: '2027-03-14T16:00:00', timeZone: 'Australia/Sydney' }

function schedule(endsAtLocal: string | null = '2027-03-14T23:30:00'): ResolvedSchedule {
  const resolved = resolveEventSchedule({ ...SYDNEY_SCHEDULE, endsAtLocal })
  if (resolved === null) throw new Error('fixture did not resolve')
  return resolved
}

/**
 * The questions an event asks, as rows rather than as template config.
 *
 * One of each shipped type, because the block draws a different control for
 * each and a fixture with only text questions would let the choice controls
 * rot. Ids are readable rather than uuids so a failing assertion says which
 * question it was about.
 */
const QUESTIONS: readonly RsvpQuestion[] = [
  {
    id: 'name',
    type: 'short_answer',
    prompt: 'Your name',
    position: 1,
    required: true,
    options: null,
    piiClass: 'identity',
  },
  {
    id: 'email',
    type: 'email',
    prompt: 'Email, so we can send you the details',
    position: 2,
    required: false,
    options: null,
    piiClass: 'contact',
  },
  {
    id: 'dietary',
    type: 'long_answer',
    prompt: 'Anything we should know about food?',
    position: 3,
    required: false,
    options: null,
    piiClass: 'sensitive',
  },
  {
    id: 'course',
    type: 'multiple_choice',
    prompt: 'Which will you have?',
    position: 4,
    required: false,
    options: [
      { value: 'fish', label: 'Fish' },
      { value: 'beef', label: 'Beef' },
    ],
    piiClass: 'none',
  },
  {
    id: 'events',
    type: 'checkbox',
    prompt: 'Which events will you be at?',
    position: 5,
    required: false,
    options: [
      { value: 'ceremony', label: 'Ceremony' },
      { value: 'dinner', label: 'Dinner' },
    ],
    piiClass: 'none',
  },
]

/**
 * The control a form field name belongs to, read out of the markup.
 *
 * Attribute order is React's business and changes between versions, so the
 * assertions above go through this rather than through a regex that happens to
 * match today's order. It reads the tag, the type and whether the control is
 * required, which is what the tests are actually about.
 */
function controlFor(
  markup: string,
  name: string
): { tag: string; type: string | null; required: boolean } | null {
  const match = new RegExp(`<(input|textarea|select)([^>]*name="${name}"[^>]*)>`).exec(markup)
  if (match === null) return null

  const attributes = match[2] ?? ''
  return {
    tag: match[1] as string,
    type: /type="([^"]+)"/.exec(attributes)?.[1] ?? null,
    required: /\brequired(=|\s|$)/.test(attributes),
  }
}

/** Every option control sharing one field name, in the order they are drawn. */
function optionsFor(markup: string, name: string): { type: string; value: string }[] {
  return [...markup.matchAll(new RegExp(`<input([^>]*name="${name}"[^>]*)>`, 'g'))].map((match) => {
    const attributes = match[1] ?? ''
    return {
      type: /type="([^"]+)"/.exec(attributes)?.[1] ?? '',
      value: /value="([^"]+)"/.exec(attributes)?.[1] ?? '',
    }
  })
}

async function neverCalled(): Promise<RsvpSubmitResult> {
  throw new Error('the RSVP submit prop was called during a render test')
}

function context(overrides: Partial<BlockContext> = {}): BlockContext {
  return {
    schedule: schedule(),
    nowMs: Date.parse('2027-03-12T02:00:00Z'),
    rsvp: { phase: 'open', questions: QUESTIONS, submit: neverCalled },
    ...overrides,
  }
}

function block(id: string): TemplateBlock {
  const found = definition.blocks.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`the seed has no block called ${id}`)
  return found
}

function render(id: string, blockContext: BlockContext = context()): string {
  return renderToStaticMarkup(renderBlock(block(id), blockContext))
}

/** The three lines of the stacked names lockup, in order. */
function nameLines(markup: string): string[] {
  return [...markup.matchAll(/<span data-name-line="\d+"[^>]*>([^<]*)<\/span>/g)].map(
    (match) => match[1] as string
  )
}

/** Everything inside the h1, tags stripped, which is what a screen reader reads. */
function headingText(markup: string): string {
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)
  return (heading?.[1] ?? '').replace(/<[^>]+>/g, '').trim()
}

describe('the hero', () => {
  it('renders the buyer copy, with the headline as the page heading', () => {
    const markup = render('hero')

    expect(markup).toContain('<h1')
    expect(markup).toContain('Together with their families')
    expect(markup).toContain('are getting married')
  })

  it('stacks the names, because a lockup on one line overflows 320px', () => {
    // The first finding in data/ip-design-directions/report.md, and it was
    // caught by rendering rather than by arithmetic: "Emma & Jake" fits on one
    // line at 320px in all three directions and "Alexandra & Christopher" does
    // not. Reverting this to a side by side layout reintroduces a real bug, so
    // the three lines are asserted by their content rather than by counting
    // them.
    const markup = renderToStaticMarkup(
      <HeroBlock blockId="hero" config={{ headline: 'Alexandra & Christopher' }} />
    )

    expect(nameLines(markup)).toEqual(['Alexandra', '&amp;', 'Christopher'])
  })

  it('leaves the heading reading as one name, so it is not three fragments aloud', () => {
    const markup = render('hero')

    // The lines are block level elements, so the spaces between them are thrown
    // away by the layout and kept in the markup. A screen reader, and the
    // accessible name of the heading, still get "Sarah & Tom".
    expect(headingText(markup)).toBe('Sarah &amp; Tom')
  })

  it('leaves a headline with no join in it alone rather than inventing a break', () => {
    const markup = renderToStaticMarkup(
      <HeroBlock blockId="hero" config={{ headline: 'The Ramaswamy Wedding' }} />
    )

    expect(nameLines(markup)).toEqual(['The Ramaswamy Wedding'])
  })

  it.each([
    ['an ampersand', 'Emma & Jake', ['Emma', '&amp;', 'Jake']],
    ['the word and', 'Emma and Jake', ['Emma', 'and', 'Jake']],
    ['a plus', 'Emma + Jake', ['Emma', '+', 'Jake']],
    // "Alexander" contains "and", so a naive substring split would cut a name
    // in half. The joins are matched with the spaces around them for that
    // reason, and this is the case that proves it.
    ['a name containing the join word', 'Alexander & Jake', ['Alexander', '&amp;', 'Jake']],
  ])('splits on %s', (_name, headline, expected) => {
    const markup = renderToStaticMarkup(<HeroBlock blockId="hero" config={{ headline }} />)

    expect(nameLines(markup)).toEqual(expected)
  })
})

describe('the hero artwork band', () => {
  const ARTWORK = '/samples/unlicensed-placeholder/floral-band-UNLICENSED-PLACEHOLDER.jpg'

  function artworkImg(markup: string): string | null {
    return (
      /<img[^>]*data-artwork-probe[^>]*>|<div data-hero-artwork="">(<img[^>]*>)/.exec(
        markup
      )?.[1] ?? null
    )
  }

  it('draws the artwork the template names, at the very top of the page', () => {
    const markup = render('hero')

    // The band is the first thing inside the hero section, before the eyebrow,
    // because "on top of the page I want to see invitation" is what it is for.
    const band = markup.indexOf('data-hero-artwork')
    const eyebrow = markup.indexOf('Together with their families')

    expect(band).toBeGreaterThan(-1)
    expect(band).toBeLessThan(eyebrow)
    expect(markup).toContain(ARTWORK)
  })

  it("gives it empty alt text and hides it, so nobody hears somebody else's invitation read out", () => {
    // The reason this matters more than it looks: the supplied placeholder is a
    // whole card with a name, a date and an address painted into it. Announced,
    // it would tell a guest the wrong wedding.
    const img = artworkImg(render('hero'))

    expect(img).not.toBeNull()
    expect(img).toContain('alt=""')
    expect(img).toContain('aria-hidden="true"')
  })

  it('keeps it off the critical path, because the names are what a guest came to read', () => {
    const img = artworkImg(render('hero'))

    expect(img).toContain('loading="lazy"')
    expect(img).toContain('fetchPriority="low"')
    expect(img).toContain('decoding="async"')
  })

  it('draws nothing at all when the template names no artwork', () => {
    const markup = renderToStaticMarkup(
      <HeroBlock blockId="hero" config={{ headline: 'Sarah & Tom' }} />
    )

    expect(markup).not.toContain('data-hero-artwork')
    expect(markup).not.toContain('<img')
  })

  it('draws no text over it, so no contrast on this page is measured against a picture', () => {
    // The contrast suite measures token against token. Text sitting on the
    // artwork would be text whose legibility that suite cannot see, and the
    // artwork is a placeholder whose replacement could be any colour at all.
    const markup = render('hero')
    const band = /<div data-hero-artwork="">.*?<\/div>/s.exec(markup)?.[0] ?? ''

    expect(band).not.toBe('')
    expect(band.replace(/<[^>]*>/g, '').trim()).toBe('')
  })

  it('sits in one wrapper the envelope reveal can clip and animate as a unit', () => {
    // Not built, and not to be foreclosed. The band and the lockup are one
    // section with no positioning reaching in from outside it.
    const markup = render('hero')

    expect(markup).toMatch(/<section[^>]*data-block-id="hero"[^>]*>\s*<div data-hero-artwork="">/)
  })
})

describe('the details list', () => {
  it('reads the date and the time off the event row, formatted once', () => {
    const markup = render('event-details')

    // The seed stores "source": "event-date", not a date, so this is the only
    // place the wall clock becomes words. If it ever disagreed with the
    // countdown, one of them would be reading a different field.
    expect(markup).toContain('Sunday 14 March 2027')
    expect(markup).toContain('4:00 pm')
    expect(markup).toContain('Garden formal. Flat shoes for the lawn.')
  })

  it('drops an item whose source has nothing behind it rather than labelling a blank', () => {
    const withEndTime: TemplateBlock = {
      id: 'event-details',
      type: 'details',
      config: {
        heading: 'The day',
        items: [
          { label: 'Starts', source: 'event-start-time' },
          { label: 'Ends', source: 'event-end-time' },
        ],
      },
    }

    const withEnd = renderToStaticMarkup(renderBlock(withEndTime, context()))
    expect(withEnd).toContain('Ends')
    expect(withEnd).toContain('11:30 pm')

    const withoutEnd = renderToStaticMarkup(
      renderBlock(withEndTime, context({ schedule: schedule(null) }))
    )
    expect(withoutEnd).toContain('4:00 pm')
    expect(withoutEnd).not.toContain('Ends')
  })

  it('renders nothing at all when no item has a value, rather than a lone heading', () => {
    const onlyEndTime: TemplateBlock = {
      id: 'event-details',
      type: 'details',
      config: { heading: 'The day', items: [{ label: 'Ends', source: 'event-end-time' }] },
    }

    expect(
      renderToStaticMarkup(renderBlock(onlyEndTime, context({ schedule: schedule(null) })))
    ).toBe('')
  })
})

describe('the countdown', () => {
  const target = schedule().startsAt

  it('counts to the instant the local pair resolves to, in the units the template asked for', () => {
    const markup = render(
      'countdown',
      context({ nowMs: target - (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000) })
    )

    expect(markup).toContain('Counting down')
    expect(unitValues(markup)).toEqual({ days: '2', hours: '3', minutes: '4' })
  })

  it('says the thing the template wrote once the event has started', () => {
    const markup = render('countdown', context({ nowMs: target + 60_000 }))

    expect(markup).toContain('Today is the day. See you there.')
    expect(markup).not.toContain('data-testid="countdown-units"')
  })

  it('renders singular and plural unit labels from the value, not from the unit', () => {
    const markup = render(
      'countdown',
      context({ nowMs: target - (86_400_000 + 3_600_000 + 60_000) })
    )

    expect(unitValues(markup)).toEqual({ days: '1', hours: '1', minutes: '1' })
    expect(markup).toContain('>day<')
    expect(markup).toContain('>hour<')
    expect(markup).toContain('>minute<')
  })
})

describe('the map', () => {
  it('renders the venue and links out to a maps app rather than embedding one', () => {
    const markup = render('venue-map')

    expect(markup).toContain('The Boathouse, Shelly Beach')
    expect(markup).toContain('1 Marine Parade, Manly NSW 2095')
    expect(markup).toContain('href="https://maps.google.com/?q=The+Boathouse+Shelly+Beach+Manly"')
    // No provider script and no iframe on a page a guest opens on bad wifi.
    expect(markup).not.toContain('<iframe')
  })
})

describe('the RSVP form', () => {
  it('asks the envelope questions it can never skip, and one control per stored question', () => {
    const markup = render('rsvp')

    // The envelope. Neither is a question: both are columns on `rsvps`.
    expect(markup).toContain('name="attendance"')
    expect(markup).toContain('name="party_size"')

    // One control per question, named by question id, which is what the write
    // path resolves an answer against.
    for (const question of QUESTIONS) {
      expect(markup).toContain(`name="q:${question.id}"`)
      expect(markup).toContain(question.prompt)
    }

    expect(markup).toContain('Send RSVP')
  })

  it('draws each question type as the control that type needs', () => {
    const markup = render('rsvp')

    // short_answer: a text input
    expect(controlFor(markup, 'q:name')).toMatchObject({ tag: 'input', type: 'text' })
    // email: an email input, so a phone offers the right keyboard
    expect(controlFor(markup, 'q:email')).toMatchObject({ tag: 'input', type: 'email' })
    // long_answer: a textarea
    expect(controlFor(markup, 'q:dietary')).toMatchObject({ tag: 'textarea' })
    // multiple_choice: one radio per option, sharing a name
    expect(optionsFor(markup, 'q:course')).toEqual([
      { type: 'radio', value: 'fish' },
      { type: 'radio', value: 'beef' },
    ])
    // checkbox: one checkbox per option, sharing a name
    expect(optionsFor(markup, 'q:events')).toEqual([
      { type: 'checkbox', value: 'ceremony' },
      { type: 'checkbox', value: 'dinner' },
    ])
  })

  it('marks only the questions the rows say are required', () => {
    const markup = render('rsvp')

    expect(controlFor(markup, 'q:name')?.required).toBe(true)
    expect(controlFor(markup, 'q:dietary')?.required).toBe(false)
    expect(controlFor(markup, 'q:email')?.required).toBe(false)
  })

  it('asks nothing at all when the event has no questions, rather than an empty form', () => {
    const markup = render(
      'rsvp',
      context({ rsvp: { phase: 'open', questions: [], submit: neverCalled } })
    )

    // The envelope still stands: an RSVP that does not say yes or no is not an
    // RSVP, whatever else the buyer did or did not ask.
    expect(markup).toContain('name="attendance"')
    expect(markup).not.toContain('name="q:')
  })

  it('carries a honeypot no guest can reach', () => {
    const markup = render('rsvp')

    expect(markup).toContain('name="website"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('tabindex="-1"')
  })

  it('tells a guest what happens to their reply, and links to the statement that says so', () => {
    const markup = render('rsvp')

    expect(markup).toContain('href="/privacy"')
  })

  it('drops the party size control when the template turned it off', () => {
    const noGuestCount: TemplateBlock = {
      id: 'rsvp',
      type: 'rsvp-form',
      config: {
        submitLabel: 'Send RSVP',
        successMessage: 'Thank you.',
        closedMessage: 'RSVPs are closed.',
        guestCount: { enabled: false, max: 6 },
      },
    }

    const markup = renderToStaticMarkup(renderBlock(noGuestCount, context()))

    expect(markup).not.toContain('name="party_size"')
    // The questions are rows, so turning off the envelope control changes
    // nothing about what the event asks.
    expect(markup).toContain('name="q:name"')
  })

  it('serves the closed message during grace, with nothing left to submit', () => {
    const markup = render(
      'rsvp',
      context({ rsvp: { phase: 'closed', questions: QUESTIONS, submit: neverCalled } })
    )

    expect(markup).toContain(
      'RSVPs are closed for this event. Please contact Sarah or Tom directly.'
    )
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('Send RSVP')
    // And no question is on screen either: a closed form that still lists what
    // it would have asked is a form a guest will try to fill in.
    expect(markup).not.toContain('name="q:')
  })

  it('offers a party size only up to the maximum the template set', () => {
    const markup = render('rsvp')
    const options = [...markup.matchAll(/<option value="(\d+)"/g)].map((match) => match[1])

    // The seed says max 6. An RSVP for 7 would be a row the database refuses.
    expect(options).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})

describe('the block set as a whole', () => {
  it('has a component for every type in the registry', () => {
    // Not a count. Every type the format knows about is rendered here, so a
    // sixth block type added to the schema map fails until it has a component.
    const rendered = BLOCK_TYPES.map((type: BlockType) => {
      const found = definition.blocks.find((candidate) => candidate.type === type)
      if (found === undefined) throw new Error(`the seed has no ${type} block`)
      return [type, renderToStaticMarkup(renderBlock(found, context())).length > 0]
    })

    expect(Object.fromEntries(rendered)).toEqual({
      hero: true,
      details: true,
      countdown: true,
      map: true,
      'rsvp-form': true,
    })
  })

  it('renders the page in template order, because that order is the invitation', () => {
    const markup = renderToStaticMarkup(
      <BlockList blocks={definition.blocks} context={context()} />
    )
    const order = [...markup.matchAll(/data-block-id="([^"]+)"/g)].map((match) => match[1])

    expect(order).toEqual(['hero', 'event-details', 'countdown', 'venue-map', 'rsvp'])
  })
})

describe('ThemeScope', () => {
  it('writes every token the schema emits, and nothing else, onto one element', () => {
    const tokens = themePipeline.parse(readSeedFile(IVORY_THEME)).tokens
    const markup = renderToStaticMarkup(
      <ThemeScope tokens={tokens}>
        <p>a page</p>
      </ThemeScope>
    )

    expect(markup).toContain('--color-bg:#fdfbf7')
    expect(markup).toContain('--space-md:1.25rem')
    expect(markup).toContain('--font-heading:&#x27;Cormorant Garamond&#x27;, Georgia, serif')
    expect(markup).toContain('--text-display-size:2.5rem')
    expect(markup).toContain('--radius-pill:999rem')
  })

  it('produces a different page from the same blocks when handed a different theme', () => {
    // The whole claim of keeping tokens out of the definition: one block set,
    // one set of words, two listings that do not look alike.
    const ivory = renderToStaticMarkup(
      <ThemeScope tokens={themePipeline.parse(readSeedFile(IVORY_THEME)).tokens}>
        <BlockList blocks={definition.blocks} context={context()} />
      </ThemeScope>
    )
    const midnight = renderToStaticMarkup(
      <ThemeScope tokens={themePipeline.parse(readSeedFile(MIDNIGHT_THEME)).tokens}>
        <BlockList blocks={definition.blocks} context={context()} />
      </ThemeScope>
    )

    expect(ivory).toContain('--color-bg:#fdfbf7')
    expect(midnight).toContain('--color-bg:#0d0f1a')

    // Same markup, different custom properties. If the blocks differed at all,
    // something in them is reading the theme instead of a token.
    expect(stripStyles(ivory)).toBe(stripStyles(midnight))
  })
})

function unitValues(markup: string): Record<string, string> {
  const units = [...markup.matchAll(/data-unit="([a-z]+)"><div[^>]*>(\d+)</g)]
  return Object.fromEntries(units.map((match) => [match[1], match[2]]))
}

function stripStyles(markup: string): string {
  return markup.replace(/ style="[^"]*"/g, '')
}
