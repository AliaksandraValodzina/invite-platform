import { expect, test } from '@playwright/test'

import { resolveSeedConfig, type SeededEvent } from '../../scripts/seed-event'
import { DEFAULT_RSVP_QUESTIONS } from '../../src/lib/rsvp/questions.ts'
import { signIn } from '../support/auth'
import { openEnvelope } from '../support/envelope'
import { GUEST_QUESTION_PROMPTS, seedGuestEvent } from '../support/events'

/**
 * The loop this stage exists to close: a guest replies, and the buyer reads it
 * back.
 *
 * Every assertion here reads a value rather than the absence of an error. The
 * sibling project shipped a real bug through twenty green runs because a test
 * asserted a badge was visible without reading what it said, and this suite is
 * about somebody's allergy note ending up in front of the right person.
 *
 * The buyer signs in the way a buyer does: the auth admin API mints the same
 * one-use hash the email would have carried, and the test opens the real
 * callback route with it. Nothing about the session is faked.
 */

const config = resolveSeedConfig()

/**
 * One event AND one buyer per test.
 *
 * Not tidiness. A magic link is a one-use token stored against the auth user,
 * so a second link minted for the same address invalidates the first, and two
 * tests signing in as one buyer in parallel take turns being logged out. That
 * failed the first time this suite ran in parallel and passed every time it ran
 * alone, which is the shape of flake worth spending a fixture to remove.
 */
let seedCounter = 0

type Fixture = { readonly event: SeededEvent; readonly ownerEmail: string }

async function freshEvent(
  state: 'live' | 'grace' = 'live',
  questions?: Record<string, unknown>[]
): Promise<Fixture> {
  seedCounter += 1
  const ownerEmail = `buyer-${Date.now().toString(36)}-${seedCounter}@example.test`
  const event = await seedGuestEvent(state, {
    ownerEmail,
    ...(questions === undefined ? {} : { questions }),
  })
  return { event, ownerEmail }
}

/**
 * The default question set with the dietary question already retired.
 *
 * The seed script takes rows, so a fixture can start in a state a buyer would
 * take a month to reach. `defaultQuestionRows` is the same function the script
 * uses, so the rest of the set stays exactly what a real event ships with.
 */
function retiredDietaryQuestions(): Record<string, unknown>[] {
  return DEFAULT_RSVP_QUESTIONS.map((question, index) => ({
    type: question.type,
    prompt: question.prompt,
    position: index + 1,
    required: question.required,
    pii_class: question.piiClass,
    options: question.options,
    // Every object in a bulk insert has to carry the same keys, so this is
    // null rather than absent on the questions that are still asked.
    retired_at: question.key === 'dietary' ? new Date().toISOString() : null,
  }))
}

/**
 * The same JWT with its `exp` moved into the past.
 *
 * The signature stops matching, which is correct and is not what is being
 * tested: nothing in this app verifies a signature, the database does. What is
 * being tested is that the app treats a token it can see is expired as no
 * session at all.
 */
function expiredToken(token: string): string {
  const parts = token.split('.')
  const payload = JSON.parse(
    Buffer.from((parts[1] as string).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    )
  ) as Record<string, unknown>

  payload.exp = 1
  const encoded = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return [parts[0], encoded, parts[2]].join('.')
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

test.describe('replying to an invitation', () => {
  test('a guest can reply, and the buyer reads back exactly what they wrote', async ({ page }) => {
    const { event, ownerEmail } = await freshEvent()

    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)

    await page.getByLabel(GUEST_QUESTION_PROMPTS.name as string).fill('Priya Raman')
    await page.getByLabel(GUEST_QUESTION_PROMPTS.email as string).fill('Priya@Example.Test')
    await page.getByLabel(GUEST_QUESTION_PROMPTS.dietary as string).fill('coeliac, no shellfish')
    await page.getByLabel(GUEST_QUESTION_PROMPTS.message as string).fill('Cannot wait')
    await page.getByLabel('How many of you?').selectOption('3')

    await page.getByRole('button', { name: 'Send our reply' }).click()

    await expect(page.getByTestId('rsvp-success')).toHaveText(
      'Thank you. Wilhelmina and Bartholomew have your reply.'
    )

    // Now the other half, which is the half that matters: the buyer opens their
    // dashboard and finds it.
    await signIn(page, ownerEmail)
    await page.goto(`/dashboard/${event.eventId}/replies`)

    await expect(page.getByTestId('reply-summary')).toContainText('1 reply')
    await expect(page.getByTestId('reply-summary')).toContainText('3 coming')

    const row = page.getByTestId('replies-table').locator('tbody tr').first()

    // Read cell by cell, in the order the columns are drawn. A test that only
    // asserted the row exists would pass against a row of empty cells.
    await expect(row.locator('td')).toHaveText([
      'Yes',
      '3',
      'Priya Raman',
      // Stored lower cased, because two spellings of an address is two guests
      // to anything that later tries to deduplicate them.
      'priya@example.test',
      'coeliac, no shellfish',
      'Cannot wait',
    ])
  })

  test('the reply downloads as a spreadsheet the buyer can open', async ({ page }) => {
    const { event, ownerEmail } = await freshEvent()

    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)
    await page.getByLabel(GUEST_QUESTION_PROMPTS.name as string).fill('Marcus Webb')
    // A comma and a quote, because a CSV that gets either wrong turns one
    // answer into two columns or ends the field early.
    await page
      .getByLabel(GUEST_QUESTION_PROMPTS.dietary as string)
      .fill('severe nut allergy, and "no coriander"')
    await page.getByRole('button', { name: 'Send our reply' }).click()
    await expect(page.getByTestId('rsvp-success')).toBeVisible()

    await signIn(page, ownerEmail)

    const response = await page.request.get(`/dashboard/${event.eventId}/replies/export`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')
    expect(response.headers()['content-disposition']).toContain(`replies-${event.slug}-`)
    // Guest data must never be held by a cache on its way to a buyer.
    expect(response.headers()['cache-control']).toContain('no-store')

    const body = await response.text()
    expect(body).toContain('Marcus Webb')
    expect(body).toContain('"severe nut allergy, and ""no coriander"""')
  })

  test('a guest is told which answer to fix, next to the answer', async ({ page }) => {
    const { event } = await freshEvent()

    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)

    /*
     * The browser's own `required` would stop this before it left the page, so
     * the field is filled and then emptied through the DOM to reach the server
     * side check. What is being tested is that the server refuses and says
     * where, not that the browser can validate a form.
     */
    await page.getByLabel(GUEST_QUESTION_PROMPTS.email as string).fill('not-an-address')
    await page.getByLabel(GUEST_QUESTION_PROMPTS.name as string).fill('Jo Fitzgerald')
    await page.getByLabel(GUEST_QUESTION_PROMPTS.email as string).evaluate((input) => {
      ;(input as HTMLInputElement).setAttribute('type', 'text')
    })

    await page.getByRole('button', { name: 'Send our reply' }).click()

    await expect(page.getByTestId('rsvp-error')).toContainText('email address')
    // And nothing was stored, so a guest who fixes it does not send twice.
    await expect(page.getByTestId('rsvp-success')).toHaveCount(0)

    const stored = await rest(`rsvps?event_id=eq.${event.eventId}&select=id`)
    expect(await stored.json()).toEqual([])
  })

  test('an invitation whose hosting has lapsed takes no reply, form or no form', async ({
    page,
    request,
  }) => {
    const { event } = await freshEvent('grace')

    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)
    await expect(page.getByTestId('rsvp-closed')).toBeVisible()

    /*
     * The form is gone from the page, which is the part a guest sees. This is
     * the part that matters: the endpoint behind it refuses too. A guest page
     * is cached for up to a minute, so somebody can be looking at an open form
     * for an invitation that closed thirty seconds ago, and the write path is
     * what has to say no.
     */
    const response = await request.post(`/api/e/${event.slug}/rsvp`, {
      form: { attendance: 'attending', party_size: '1' },
    })

    expect(response.status()).toBe(422)
    expect(await response.json()).toMatchObject({
      ok: false,
      message: expect.stringContaining('closed'),
    })

    const stored = await rest(`rsvps?event_id=eq.${event.eventId}&select=id`)
    expect(await stored.json()).toEqual([])
  })

  test('the form a bot fills is thanked and stored nowhere', async ({ request }) => {
    const { event } = await freshEvent()

    const response = await request.post(`/api/e/${event.slug}/rsvp`, {
      form: {
        attendance: 'attending',
        party_size: '1',
        website: 'http://example.test/seo',
      },
    })

    // The answer is the one a real reply gets. Telling a form filler which
    // field gave it away is free tuning for whoever wrote it.
    expect(response.status()).toBe(201)

    const stored = await rest(`rsvps?event_id=eq.${event.eventId}&select=id`)
    expect(await stored.json()).toEqual([])
  })
})

test.describe('retiring a question', () => {
  /**
   * The test that tries to lose the answers.
   *
   * A buyer tidying their form must never destroy replies somebody already
   * gave, and the schema is what enforces it: the foreign key from answers to
   * questions restricts, so a cascade is impossible rather than discouraged.
   * This is the same rule from the outside, through the product: reply, retire
   * the question, and the answer is still on the buyer's screen.
   */
  test('keeps every answer already given', async ({ page }) => {
    const { event, ownerEmail } = await freshEvent()
    const dietaryPrompt = GUEST_QUESTION_PROMPTS.dietary as string

    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)
    await page.getByLabel(GUEST_QUESTION_PROMPTS.name as string).fill('Priya Raman')
    await page.getByLabel(dietaryPrompt).fill('severe nut allergy')
    await page.getByRole('button', { name: 'Send our reply' }).click()
    await expect(page.getByTestId('rsvp-success')).toBeVisible()

    // The buyer removes the question. Removal is retiring: `authenticated` holds
    // no DELETE privilege on this table at all, so this is the only removal
    // there is.
    const retired = await rest(
      `rsvp_questions?event_id=eq.${event.eventId}&prompt=eq.${encodeURIComponent(dietaryPrompt)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ retired_at: new Date().toISOString() }),
      }
    )
    expect(retired.status).toBe(200)
    expect(((await retired.json()) as unknown[]).length).toBe(1)

    // The answer that was already given is still there, still readable, and
    // still labelled with the question that was asked.
    await signIn(page, ownerEmail)
    await page.goto(`/dashboard/${event.eventId}/replies`)

    await expect(page.getByRole('columnheader', { name: dietaryPrompt })).toBeVisible()
    await expect(page.getByTestId('replies-table')).toContainText('severe nut allergy')
    await expect(page.getByText('no longer asked')).toBeVisible()
  })

  /**
   * And a retired question is not asked again.
   *
   * Seeded retired rather than retired mid-test, because the guest page is
   * deliberately cached for up to a minute (src/lib/serving/cache.ts) and a
   * test that retired a question and immediately reloaded would be asserting
   * that the cache does not exist. What is contracted is that a page rendered
   * after the change does not carry the question, which is what this renders.
   */
  test('stops asking new guests', async ({ page }) => {
    const { event } = await freshEvent('live', retiredDietaryQuestions())
    const dietaryPrompt = GUEST_QUESTION_PROMPTS.dietary as string

    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)

    await expect(page.getByLabel(GUEST_QUESTION_PROMPTS.name as string)).toBeVisible()
    await expect(page.getByLabel(dietaryPrompt)).toHaveCount(0)
  })
})

test.describe('who can read a reply', () => {
  test('a stranger signed into their own account cannot open somebody elses replies', async ({
    page,
  }) => {
    const { event } = await freshEvent()

    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)
    await page.getByLabel(GUEST_QUESTION_PROMPTS.name as string).fill('Priya Raman')
    await page.getByRole('button', { name: 'Send our reply' }).click()
    await expect(page.getByTestId('rsvp-success')).toBeVisible()

    /*
     * A real second buyer with a real session, not a signed out browser. The
     * failure this catches is the one a single tenant product finds out about
     * in production: row level security answers "somebody else's event" with no
     * rows, and a page that treated no rows as "show it anyway" would be the
     * whole guarantee undone in one component.
     */
    const stranger = await freshEvent()

    await signIn(page, stranger.ownerEmail)
    const response = await page.goto(`/dashboard/${event.eventId}/replies`)

    expect(response?.status()).toBe(404)
    await expect(page.getByText('Priya Raman')).toHaveCount(0)
  })

  test('a signed out browser is sent to sign in rather than shown anything', async ({ page }) => {
    const { event } = await freshEvent()

    await page.context().clearCookies()
    await page.goto(`/dashboard/${event.eventId}/replies`)

    await expect(page).toHaveURL(/\/login$/)
  })

  /**
   * The state that arrives on its own after an hour, and the reason
   * `currentBuyer` checks the expiry as well as the proxy.
   *
   * A session that cannot be refreshed has to read as signed out. The failure it
   * replaces is worse than it looks: a page that trusted a dead token would
   * render the signed-in shell with an empty table, which a buyer reads as their
   * replies having disappeared.
   */
  test('a session that cannot be refreshed reads as signed out, not as an empty dashboard', async ({
    page,
  }) => {
    const { event, ownerEmail } = await freshEvent()

    await signIn(page, ownerEmail)
    await expect(page.getByTestId('reply-summary')).toHaveCount(0)

    // Keep the access token, throw away the refresh token. That is exactly the
    // jar a browser has an hour after signing in if the refresh was revoked.
    const cookies = await page.context().cookies()
    await page.context().clearCookies()
    const access = cookies.find((cookie) => cookie.name === 'ip_access')
    if (access === undefined) throw new Error('signing in set no access cookie')
    await page.context().addCookies([
      {
        ...access,
        // An access token whose expiry has passed, made by keeping the token
        // and moving the clock is not possible here, so the token itself is
        // replaced with one that is structurally valid and long expired.
        value: expiredToken(access.value),
      },
    ])

    await page.goto(`/dashboard/${event.eventId}/replies`)

    await expect(page).toHaveURL(/\/login$/)
  })
})
