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

async function neverCalled(): Promise<RsvpSubmitResult> {
  throw new Error('the RSVP submit prop was called during a render test')
}

function context(overrides: Partial<BlockContext> = {}): BlockContext {
  return {
    schedule: schedule(),
    nowMs: Date.parse('2027-03-12T02:00:00Z'),
    rsvp: { phase: 'open', submit: neverCalled },
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
  it('asks only the questions the template enabled, and always asks the two it cannot skip', () => {
    const markup = render('rsvp')

    expect(markup).toContain('name="guest_name"')
    expect(markup).toContain('name="attendance"')
    expect(markup).toContain('name="guest_email"')
    expect(markup).toContain('name="dietary_notes"')
    expect(markup).toContain('name="message"')
    expect(markup).toContain('Send RSVP')
  })

  it('drops the fields the template disabled', () => {
    const emailOnly: TemplateBlock = {
      id: 'rsvp',
      type: 'rsvp-form',
      config: {
        submitLabel: 'Send RSVP',
        successMessage: 'Thank you.',
        closedMessage: 'RSVPs are closed.',
        fields: {
          email: { enabled: true },
          guestCount: { enabled: false, max: 6 },
          dietary: { enabled: false },
          message: { enabled: false },
        },
      },
    }

    const markup = renderToStaticMarkup(renderBlock(emailOnly, context()))

    expect(markup).toContain('name="guest_email"')
    expect(markup).not.toContain('name="party_size"')
    expect(markup).not.toContain('name="dietary_notes"')
    expect(markup).not.toContain('name="message"')
  })

  it('serves the closed message during grace, with nothing left to submit', () => {
    const markup = render('rsvp', context({ rsvp: { phase: 'closed', submit: neverCalled } }))

    expect(markup).toContain(
      'RSVPs are closed for this event. Please contact Sarah or Tom directly.'
    )
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('Send RSVP')
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
