import { afterEach, describe, expect, it, vi } from 'vitest'

import { guestPageQuery, isPossibleSlug, loadGuestPage } from '@/lib/supabase/events'

/**
 * The read path, without a database.
 *
 * What is worth asserting here is not "it returns rows". It is every way the
 * read can fail, because each one has a different designed answer on screen and
 * getting them the wrong way round is how a guest ends up looking at a stack
 * trace or, worse, at somebody else's placeholder names.
 *
 *   no row               404. The link is wrong.
 *   database unreachable a notice. Ours, not theirs.
 *   published, no        a notice. The template defaults are Sarah and Tom, and
 *     content revision    showing those to real guests is the failure
 *                         src/lib/template/resolve.ts refuses by design.
 *   unpublished, no      the unpublished notice, which needs no content at all.
 *     content revision
 *
 * The live database is exercised end to end by tests/e2e/guest-page.spec.ts.
 */

const ROW = {
  id: '2f73cf07-66db-4d39-8352-754f93cf25e7',
  slug: 'emma-jake-11ea91',
  title: 'Emma & Jake',
  starts_at_local: '2027-03-14T16:00:00',
  ends_at_local: '2027-03-14T23:30:00',
  time_zone: 'Australia/Sydney',
  serving_state: 'live',
  templates: { definition: { version: 2, blocks: [] }, theme: { version: 1, tokens: {} } },
  event_content: [
    { revision: 3, content: { version: 1, blocks: {} }, theme: { version: 1, tokens: {} } },
  ],
  rsvp_questions: [
    {
      id: 'q-name',
      type: 'short_answer',
      prompt: 'Your name',
      position: 1,
      required: true,
      options: null,
      pii_class: 'identity',
    },
    {
      id: 'q-course',
      type: 'multiple_choice',
      prompt: 'Which will you have?',
      position: 2,
      required: false,
      options: [
        { value: 'fish', label: 'Fish' },
        { value: 'beef', label: 'Beef' },
      ],
      pii_class: 'none',
    },
  ],
}

function stubEnvironment(): void {
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'a-service-role-key')
}

function stubFetch(
  response: { status?: number; body?: unknown } | Error
): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async () => {
    if (response instanceof Error) throw response
    return new Response(JSON.stringify(response.body ?? []), {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('isPossibleSlug', () => {
  it('accepts the shape mint_event_slug produces', () => {
    expect(isPossibleSlug('emma-jake-11ea91')).toBe(true)
    expect(isPossibleSlug('abc')).toBe(true)
  })

  it('rejects everything events_slug_format would reject', () => {
    for (const slug of ['Emma-Jake', 'emma_jake', 'em', 'a'.repeat(65), '-leading', 'trailing-']) {
      expect(isPossibleSlug(slug), `"${slug}" was accepted`).toBe(false)
    }
  })

  it('rejects a path traversal, so a stray URL segment never reaches the database', () => {
    expect(isPossibleSlug('../../etc/passwd')).toBe(false)
  })
})

describe('guestPageQuery', () => {
  const query = guestPageQuery('emma-jake-11ea91')

  it('matches the slug exactly', () => {
    expect(query).toContain('slug=eq.emma-jake-11ea91')
  })

  it('asks for the serving state as part of the same read', () => {
    // Two reads would be two clocks and two cache lifetimes, and a page could
    // then outlive the state it was rendered from. See the migration.
    expect(query).toContain('serving_state')
  })

  it('narrows the embedded content to the published revision', () => {
    expect(decodeURIComponent(query)).toContain('event_content.is_published=is.true')
  })
})

describe('loadGuestPage', () => {
  it('does not reach the database for a slug the database could not hold', async () => {
    stubEnvironment()
    const fetchStub = stubFetch({ body: [] })

    await expect(loadGuestPage('NOT a slug')).resolves.toEqual({ kind: 'not-found' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('reports a missing row as not found', async () => {
    stubEnvironment()
    stubFetch({ body: [] })

    await expect(loadGuestPage('emma-jake-11ea91')).resolves.toEqual({ kind: 'not-found' })
  })

  it('reports an unreachable database as unavailable rather than as a missing event', async () => {
    stubEnvironment()
    stubFetch(new Error('connect ECONNREFUSED'))

    const outcome = await loadGuestPage('emma-jake-11ea91')

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('ECONNREFUSED')
  })

  it('reports an error status as unavailable, with the status in the reason', async () => {
    stubEnvironment()
    stubFetch({ status: 500, body: { message: 'boom' } })

    const outcome = await loadGuestPage('emma-jake-11ea91')

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('500')
  })

  it('maps the row onto the four documents the resolver takes', async () => {
    stubEnvironment()
    stubFetch({ body: [ROW] })

    const outcome = await loadGuestPage('emma-jake-11ea91')

    expect(outcome.kind).toBe('found')
    if (outcome.kind !== 'found') return

    expect(outcome.state).toBe('live')
    expect(outcome.revision).toBe(3)
    expect(outcome.event).toEqual({
      id: ROW.id,
      slug: ROW.slug,
      title: ROW.title,
      startsAtLocal: ROW.starts_at_local,
      endsAtLocal: ROW.ends_at_local,
      timeZone: ROW.time_zone,
    })
    expect(outcome.documents).toEqual({
      definition: ROW.templates.definition,
      theme: ROW.templates.theme,
      content: ROW.event_content[0]!.content,
      themeOverride: ROW.event_content[0]!.theme,
    })
  })

  it('reads the questions the form has to draw, on the same request as the event', async () => {
    stubEnvironment()
    const fetchStub = stubFetch({ body: [ROW] })

    const outcome = await loadGuestPage('emma-jake-11ea91')

    expect(outcome.kind).toBe('found')
    if (outcome.kind !== 'found') return

    // One request. A second read would be a second clock and a second cache
    // lifetime, and the form a guest fills in has to be the form the write path
    // is about to validate against.
    expect(fetchStub).toHaveBeenCalledTimes(1)

    expect(outcome.questions).toEqual([
      {
        id: 'q-name',
        type: 'short_answer',
        prompt: 'Your name',
        position: 1,
        required: true,
        options: null,
        piiClass: 'identity',
      },
      {
        id: 'q-course',
        type: 'multiple_choice',
        prompt: 'Which will you have?',
        position: 2,
        required: false,
        options: [
          { value: 'fish', label: 'Fish' },
          { value: 'beef', label: 'Beef' },
        ],
        piiClass: 'none',
      },
    ])
  })

  it('asks the database for live questions in position order, and no retired one', () => {
    const query = guestPageQuery('emma-jake-11ea91')

    // Filtered in the query rather than after it, so a retired question never
    // reaches a page even if something downstream forgets.
    expect(query).toContain('rsvp_questions.retired_at=is.null')
    expect(query).toContain('rsvp_questions.order=position.asc')
  })

  /**
   * A question type the database knows and this deploy does not is a deploy
   * older than its database. Drawing a control for it would collect an answer
   * this build cannot store, so the question is left off the form instead,
   * which is visible and cannot lose an answer already given.
   */
  it('leaves off a question this deploy cannot draw, rather than drawing it wrong', async () => {
    stubEnvironment()
    stubFetch({
      body: [
        {
          ...ROW,
          rsvp_questions: [
            ...ROW.rsvp_questions,
            {
              id: 'q-future',
              type: 'rating',
              prompt: 'How excited are you?',
              position: 3,
              required: false,
              options: null,
              pii_class: 'none',
            },
          ],
        },
      ],
    })

    const outcome = await loadGuestPage('emma-jake-11ea91')

    expect(outcome.kind).toBe('found')
    if (outcome.kind !== 'found') return
    expect(outcome.questions.map((question) => question.id)).toEqual(['q-name', 'q-course'])
  })

  it('refuses to serve a published event that has no published content revision', async () => {
    stubEnvironment()
    stubFetch({ body: [{ ...ROW, event_content: [] }] })

    const outcome = await loadGuestPage('emma-jake-11ea91')

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('no published content')
  })

  it('serves an unpublished event with no revision, because that page shows no content', async () => {
    stubEnvironment()
    stubFetch({ body: [{ ...ROW, serving_state: 'unpublished', event_content: [] }] })

    const outcome = await loadGuestPage('emma-jake-11ea91')

    expect(outcome.kind).toBe('found')
    if (outcome.kind === 'found') expect(outcome.state).toBe('unpublished')
  })

  it('reports a row shape this deploy does not understand rather than rendering half of it', async () => {
    stubEnvironment()
    stubFetch({ body: [{ ...ROW, serving_state: 'somewhat-live' }] })

    const outcome = await loadGuestPage('emma-jake-11ea91')

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('serving_state')
  })

  it('sends the service role key, and asks Next to cache the read for the page lifetime', async () => {
    stubEnvironment()
    const fetchStub = stubFetch({ body: [ROW] })

    await loadGuestPage('emma-jake-11ea91')

    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit & { next: unknown }]
    expect(url).toContain('http://127.0.0.1:54321/rest/v1/events?')
    expect((init.headers as Record<string, string>).apikey).toBe('a-service-role-key')
    expect(init.next).toEqual({ revalidate: 60, tags: ['event:emma-jake-11ea91'] })
  })
})
