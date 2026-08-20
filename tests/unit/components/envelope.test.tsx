/**
 * The envelope, rendered to markup.
 *
 * The assertion this file exists for is the last one: the invitation is in the
 * document while the cover is closed. Everything else about the envelope is
 * decoration, and that one is the contract. A cover that shipped with the page
 * missing from the markup would look identical in a screenshot and would be a
 * guest who cannot read the details or reply.
 *
 * The opening mechanism is asserted as markup rather than as behaviour on
 * purpose. There is no JavaScript in it: it is a checkbox, a label pointing at
 * that checkbox, and a sibling selector. So what a browser will do is decided by
 * these four facts about the markup, and `tests/e2e/envelope.spec.ts` is what
 * confirms a real browser agrees, including with scripting turned off.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BlockList, type BlockContext } from '@/components/blocks'
import {
  DEFAULT_OPEN_LABEL,
  EnvelopeCover,
  envelopeHeadline,
  sealInitials,
} from '@/components/envelope'
import { ThemeScope } from '@/components/theme-scope'
import { resolveEventSchedule } from '@/lib/event/time'
import type { RsvpQuestion } from '@/lib/rsvp/questions'
import {
  EMPTY_EVENT_CONTENT,
  resolveEventPage,
  UNIVERSAL_ENVELOPE,
  type EnvelopeConfig,
} from '@/lib/template'

import { CLASSIC_INVITATION, IVORY_THEME, readSeedFile } from '../template/seed-files'

const page = (() => {
  const outcome = resolveEventPage({
    definition: readSeedFile(CLASSIC_INVITATION),
    theme: readSeedFile(IVORY_THEME),
    content: EMPTY_EVENT_CONTENT,
    themeOverride: { version: 1, tokens: {} },
  })
  if (!outcome.ok) throw new Error(`the committed seed did not resolve: ${outcome.message}`)
  return outcome.page
})()

const QUESTIONS: readonly RsvpQuestion[] = [
  {
    id: 'question-name',
    type: 'short_answer',
    prompt: 'Your name',
    position: 1,
    required: true,
    options: null,
    piiClass: 'identity',
  },
]

function blockContext(): BlockContext {
  const schedule = resolveEventSchedule({
    startsAtLocal: '2027-03-14T16:00:00',
    endsAtLocal: '2027-03-14T23:30:00',
    timeZone: 'Australia/Sydney',
  })
  if (schedule === null) throw new Error('fixture did not resolve')

  return {
    schedule,
    nowMs: Date.parse('2027-03-12T13:00:00Z'),
    rsvp: {
      phase: 'open',
      questions: QUESTIONS,
      submit: async () => ({ ok: true as const }),
    },
  }
}

function cover(config: EnvelopeConfig, headline?: string): string {
  return renderToStaticMarkup(<EnvelopeCover config={config} headline={headline} />)
}

/**
 * The open control on its own. Searching the whole cover for "checked" would
 * find `peer-checked:invisible`, and searching a whole page would find the
 * RSVP form's own radio.
 */
function openInput(markup: string): string {
  return /<input[^>]*id="envelope-open"[^>]*>/.exec(markup)?.[0] ?? ''
}

describe('the seal', () => {
  it.each([
    ['Sarah & Tom', 'ST'],
    ['Emma and Jake', 'EJ'],
    ['Priya + Alex', 'PA'],
    ['Emma', 'E'],
    ['the wedding of the year', 'T'],
    // Both names kept whole, so a name outside the basic plane is not split in
    // half by a naive charAt.
    ['Åsa & Øyvind', 'ÅØ'],
  ])('presses %s into the wax as %s', (headline, initials) => {
    expect(sealInitials(headline)).toBe(initials)
  })

  it('is blank when the template has no names to press', () => {
    expect(sealInitials(undefined)).toBe('')
  })
})

describe('the headline', () => {
  it("is the invitation's own, read off the hero rather than stored twice", () => {
    expect(envelopeHeadline(page.blocks)).toBe('Sarah & Tom')
  })

  it('is absent when a template has no hero, rather than invented', () => {
    expect(envelopeHeadline(page.blocks.filter((block) => block.type !== 'hero'))).toBeUndefined()
  })

  it('breaks where the hero breaks it, so the two lockups agree', () => {
    const markup = cover(page.envelope, 'Alexandra & Christopher')

    expect(markup).toContain('<span class="block">Alexandra</span>')
    expect(markup).toContain('<span class="block">&amp;</span>')
    expect(markup).toContain('<span class="block">Christopher</span>')
  })

  it('is not a heading, so the page keeps exactly one h1', () => {
    const markup = renderToStaticMarkup(
      <ThemeScope
        tokens={page.tokens}
        cover={<EnvelopeCover config={page.envelope} headline="Sarah & Tom" />}
      >
        <BlockList blocks={page.blocks} context={blockContext()} />
      </ThemeScope>
    )

    expect(markup.match(/<h1[\s>]/g) ?? []).toHaveLength(1)
    // And the one there is belongs to the hero, underneath.
    expect(markup).toContain('<h1 class="type-display')
  })
})

describe('the way it opens', () => {
  const markup = cover(page.envelope, 'Sarah & Tom')

  it('is a checkbox, which is a control a browser operates without our code', () => {
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('id="envelope-open"')
    expect(markup).toContain('for="envelope-open"')
  })

  it('ships no event handler and no script, so there is nothing to hydrate', () => {
    expect(markup).not.toMatch(/onclick|<script/i)
  })

  it('starts closed, because a guest page opens on a closed envelope', () => {
    expect(openInput(markup)).not.toContain('checked')
  })

  it('starts open only when a preview asks it to', () => {
    const opened = renderToStaticMarkup(
      <EnvelopeCover config={page.envelope} headline="Sarah & Tom" startsOpen />
    )
    expect(openInput(opened)).toContain('checked')
  })

  it('says how to open it, once to a reader and once to assistive technology', () => {
    // The visible prompt is hidden from the accessibility tree because the
    // label carries the same words. Announced twice is a bug, not thoroughness.
    expect(markup).toContain('<span class="sr-only">Tap to open</span>')
    expect(markup).toContain('aria-hidden="true"')
  })
})

describe('the universal envelope', () => {
  const markup = cover(UNIVERSAL_ENVELOPE, 'Sarah & Tom')

  it('still says how to open, because a cover that does not is a dead end', () => {
    expect(markup).toContain(DEFAULT_OPEN_LABEL)
  })

  it("draws nothing where the note would be, because a note is the buyer's to remove", () => {
    expect(markup).not.toContain('data-envelope-note')
  })

  it('is drawn from tokens, with no artwork of its own', () => {
    expect(markup).toContain('data-envelope-drawn-from="tokens"')
    expect(markup).toContain('data-envelope-drawing')
    expect(markup).toContain('data-envelope-initials="ST"')
    expect(markup).not.toContain('<img')
  })
})

describe('a buyer supplied envelope', () => {
  const markup = cover({ image: { src: '/uploads/an-envelope.jpg' } }, 'Sarah & Tom')

  it('replaces the drawn envelope rather than the background', () => {
    expect(markup).toContain('data-envelope-drawn-from="image"')
    expect(markup).toContain('src="/uploads/an-envelope.jpg"')
    expect(markup).not.toContain('data-envelope-drawing')
  })

  it('carries no alt text, because the format gives it nowhere to come from', () => {
    expect(markup).toMatch(/<img[^>]*alt=""[^>]*>/)
    expect(markup).toMatch(/<img[^>]*aria-hidden="true"/)
  })

  it("leaves the cover's own words on the page colour and not on the picture", () => {
    // The picture is one item in the same column as the words, not a layer
    // behind them. Nothing on this page has its contrast measured against an
    // image. See docs/envelope.md.
    expect(markup).not.toMatch(/background-image|bg-\[url/)
  })
})

describe('the invitation underneath', () => {
  const markup = renderToStaticMarkup(
    <ThemeScope
      tokens={page.tokens}
      cover={<EnvelopeCover config={page.envelope} headline="Sarah & Tom" />}
    >
      <BlockList blocks={page.blocks} context={blockContext()} />
    </ThemeScope>
  )

  it('is in the document while the envelope is still closed', () => {
    /*
     * The whole contract, in one assertion. Not "the cover renders": the RSVP
     * form, the venue and the date are all in the markup a guest is served,
     * before anything has been clicked and with no script having run.
     */
    expect(markup).toContain('Send RSVP')
    expect(markup).toContain('The Boathouse, Shelly Beach')
    expect(markup).toContain('Your name')
    expect(markup).toContain('<h1 class="type-display')
  })

  it('is not hidden from assistive technology by the cover', () => {
    // Nothing marks the page inert or aria-hidden, because un-hiding it would
    // need the JavaScript this feature refuses to depend on.
    expect(markup).not.toContain('inert')

    // The element the whole invitation is inside, and its attributes. The
    // blocks themselves do use aria-hidden, on decorative icons and on the
    // artwork band, which is a different thing entirely.
    const column = /<div class="[^"]*max-w-prose[^"]*"[^>]*>/.exec(markup)?.[0] ?? ''
    expect(column).not.toBe('')
    expect(column).not.toContain('aria-hidden')
  })

  it('comes after the cover in the document, so the cover reads first without CSS', () => {
    expect(markup.indexOf('data-envelope=')).toBeLessThan(markup.indexOf('data-block-id="hero"'))
  })
})
