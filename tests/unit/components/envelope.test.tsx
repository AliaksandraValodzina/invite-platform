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

/** The buyer's picture on its own, with its src and srcSet attributes. */
function picture(markup: string): string {
  return /<img[^>]*data-envelope-picture[^>]*>/.exec(markup)?.[0] ?? ''
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

/**
 * A picture as the upload capability actually produces one: two content
 * addressed WebP files, named as `/a/<key>` with no hostname in the document.
 * `tests/unit/uploads/picture.test.ts` is where this shape is built from a
 * real upload; here it is what the cover has to draw.
 */
const UPLOADED_ENVELOPE = {
  src: '/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp',
  widths: [
    { src: '/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp', width: 800 },
    { src: '/a/bbbbbbbbbbbbbbbbbbbbbbbb-w1600.webp', width: 1600 },
  ],
}

describe('a buyer supplied envelope', () => {
  const markup = cover({ image: UPLOADED_ENVELOPE }, 'Sarah & Tom')

  it('replaces the drawn envelope rather than the background', () => {
    expect(markup).toContain('data-envelope-drawn-from="image"')
    expect(markup).toContain('src="/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp"')
    expect(markup).not.toContain('data-envelope-drawing')
  })

  it('offers every stored width, so the second one is not stored and never sent', () => {
    // The envelope kind is re-encoded to two widths and they are separate
    // content addresses. A cover that named one of them would be paying for
    // the other out of the event's variant budget forever.
    expect(picture(markup)).toContain(
      'srcSet="/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp 800w, ' +
        '/a/bbbbbbbbbbbbbbbbbbbbbbbb-w1600.webp 1600w"'
    )
  })

  it('draws one file with no candidate list when that is all there is', () => {
    const one = picture(cover({ image: { src: '/a/cccccccccccccccccccccccc-w800.webp' } }))
    expect(one).toContain('src="/a/cccccccccccccccccccccccc-w800.webp"')
    expect(one).not.toContain('srcSet')
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

describe("the deployment's asset hostname", () => {
  /*
   * The reason nothing stores a URL. `public.uploads` holds keys, content names
   * `/a/<key>`, and the hostname a browser actually fetches from is decided
   * here, at render time, from this deployment's configuration. Storing a
   * hostname would mean that changing object storage vendor is a rewrite of
   * every buyer's saved document rather than a DNS change. See the top of
   * src/lib/uploads/host.ts.
   */
  function withAssetHost<T>(value: string | undefined, body: () => T): T {
    const before = process.env.NEXT_PUBLIC_ASSET_HOST
    if (value === undefined) delete process.env.NEXT_PUBLIC_ASSET_HOST
    else process.env.NEXT_PUBLIC_ASSET_HOST = value

    try {
      return body()
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_ASSET_HOST
      else process.env.NEXT_PUBLIC_ASSET_HOST = before
    }
  }

  it('is applied to the picture and to every width it offers', () => {
    const markup = withAssetHost('https://assets.example.com', () =>
      picture(cover({ image: UPLOADED_ENVELOPE }))
    )

    expect(markup).toContain(
      'src="https://assets.example.com/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp"'
    )
    expect(markup).toContain(
      'srcSet="https://assets.example.com/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp 800w, ' +
        'https://assets.example.com/a/bbbbbbbbbbbbbbbbbbbbbbbb-w1600.webp 1600w"'
    )
  })

  it('leaves the app serving the bytes when none is configured', () => {
    // Not a degraded mode: it is how the whole capability runs locally and on a
    // preview deployment with no cloud credential anywhere.
    const markup = withAssetHost(undefined, () => picture(cover({ image: UPLOADED_ENVELOPE })))
    expect(markup).toContain('src="/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp"')
  })

  it('is refused when it names a storage vendor, rather than being written into a page', () => {
    const markup = withAssetHost('https://bucket.r2.dev', () =>
      picture(cover({ image: UPLOADED_ENVELOPE }))
    )

    expect(markup).not.toContain('r2.dev')
    expect(markup).toContain('src="/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp"')
  })

  it('leaves a picture that is not an upload exactly as the document named it', () => {
    const markup = withAssetHost('https://assets.example.com', () =>
      picture(cover({ image: { src: 'https://images.example.org/their-own.jpg' } }))
    )

    expect(markup).toContain('src="https://images.example.org/their-own.jpg"')
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
