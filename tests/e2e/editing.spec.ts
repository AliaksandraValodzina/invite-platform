import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { resolveSeedConfig, type SeededEvent } from '../../scripts/seed-event'
import { readFields } from '../../src/lib/editor/fields.ts'
import { BLOCK_CONFIG_SCHEMAS } from '../../src/lib/template/blocks.ts'
import { signIn } from '../support/auth'
import { openEnvelope } from '../support/envelope'
import { GUEST_QUESTION_PROMPTS, seedGuestEvent } from '../support/events'
import { photographBytes } from '../support/uploads'

/**
 * The loop this stage exists to close: a buyer puts their own details on the
 * template they bought, and a guest sees them.
 *
 * Every assertion reads a value off the page a guest gets, not an absence of an
 * error on the page the buyer typed into. A save that reports "Saved" and
 * changes nothing is exactly the bug this suite is for, and it is invisible to
 * a test that only looks at the editor.
 *
 * One event and one buyer per test. A magic link is a one-use token stored
 * against the auth user, so two tests signing in as one buyer take turns being
 * logged out; the replies suite found that the hard way and this follows it.
 */

const config = resolveSeedConfig()

type Fixture = { readonly event: SeededEvent; readonly ownerEmail: string }

/**
 * A buyer nobody else in this run shares.
 *
 * Random rather than a counter, and that is not caution: workers are separate
 * processes, so two of them starting in the same millisecond with their own
 * counter at one mint the same address. The second link then invalidates the
 * first, one test lands on the sign-in page, and the failure reads as a missing
 * form field thirty seconds later.
 */
async function freshEvent(): Promise<Fixture> {
  const ownerEmail = `editor-${randomUUID()}@example.test`
  return { event: await seedGuestEvent('live', { ownerEmail }), ownerEmail }
}

async function openEditor(page: Page, fixture: Fixture): Promise<void> {
  await signIn(page, fixture.ownerEmail)
  await page.goto(`/dashboard/${fixture.event.eventId}/edit`)

  // The editor and not the sign-in page. Both have an h1, and waiting on a
  // heading would let a signed-out run get all the way to a missing field.
  await expect(page.getByRole('button', { name: 'Save the invitation' })).toBeVisible()
}

/** Presses one of the three save buttons and waits for it to say what happened. */
async function save(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label }).click()
  const status = page.locator('[data-save-status]')
  await expect(status.first()).toBeVisible()
}

/** The content revision a guest is being served, read with the service role. */
async function publishedContent(eventId: string): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${config.url}/rest/v1/event_content?event_id=eq.${eventId}&is_published=is.true&select=revision,content`,
    {
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
      },
    }
  )

  const rows = (await response.json()) as { revision: number; content: Record<string, unknown> }[]
  const row = rows[0]
  if (row === undefined) throw new Error(`event ${eventId} has no published content revision`)
  return { revision: row.revision, ...row.content }
}

test.describe('a buyer fills in their own details', () => {
  test('changes the names, the venue and the message, and the guest page shows them', async ({
    page,
  }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await page.fill('[name="block:hero.headline"]', 'Perpetua & Cornelius')
    await page.fill('[name="block:hero.subhead"]', 'would love your company')
    await page.fill('[name="block:venue-map.venueName"]', 'The Cornelius Boathouse')
    await page.fill('[name="block:venue-map.address"]', '9 Long Reef Road\nCollaroy NSW 2097')
    await page.fill('[name="block:rsvp.heading"]', 'Are you coming?')

    await save(page, 'Save the invitation')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    await page.goto(`/e/${fixture.event.slug}`)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Perpetua & Cornelius')
    await expect(page.getByText('would love your company')).toBeVisible()
    await expect(page.getByText('The Cornelius Boathouse')).toBeVisible()
    await expect(page.getByText('9 Long Reef Road')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Are you coming?' })).toBeVisible()
  })

  test('changes the date, and the invitation reads from the event row', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await page.fill('[name="startDate"]', '2027-11-06')
    await page.fill('[name="startTime"]', '15:30')
    await page.fill('[name="endDate"]', '2027-11-06')
    await page.fill('[name="endTime"]', '23:00')

    await save(page, 'Save the details')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    await page.goto(`/e/${fixture.event.slug}`)

    /*
     * The details list formats the date off `events.starts_at_local` rather than
     * off anything in the document, which is why the date is edited in its own
     * form. A block config carrying a date would be a second answer to "when is
     * the wedding" and the countdown would be reading one of the two.
     */
    await expect(page.getByText('Saturday 6 November 2027')).toBeVisible()
    await expect(page.getByText('3:30 pm')).toBeVisible()
  })

  test('saves only what changed, so a fix to the template still reaches this event', async ({
    page,
  }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await page.fill('[name="block:hero.headline"]', 'Perpetua & Cornelius')
    await save(page, 'Save the invitation')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    const content = await publishedContent(fixture.event.eventId)
    const blocks = content.blocks as Record<string, Record<string, unknown>>

    /*
     * One key. Every other field of the hero came back exactly as the template
     * writes it and was therefore not written down, which is what keeps this
     * event tracking a fix to its template's copy.
     *
     * The fixture's own content is the sharper half of this. It stores an
     * eyebrow and a subhead that are word for word the template's, which were
     * never overrides at all, and a save removes them. Nothing on the page
     * changes; what changes is that a reworded eyebrow in the template now
     * reaches this event too.
     */
    expect(Object.keys(blocks.hero ?? {})).toEqual(['headline'])
    expect(blocks.hero?.headline).toBe('Perpetua & Cornelius')
    expect(blocks.countdown).toBeUndefined()
    expect(blocks['event-details']).toBeUndefined()
  })

  test('keeps every save as a revision rather than editing the live one in place', async ({
    page,
  }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    const before = await publishedContent(fixture.event.eventId)

    await page.fill('[name="block:hero.headline"]', 'Perpetua & Cornelius')
    await save(page, 'Save the invitation')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    const after = await publishedContent(fixture.event.eventId)

    // "Restore what it said last week" is the request that arrives the day
    // after a bad edit, and a row edited in place has already thrown it away.
    expect(after.revision).toBe((before.revision as number) + 1)
  })
})

test.describe('the form is built from the format', () => {
  /**
   * The claim, checked against the running page: every field the block schemas
   * declare has a control, and the names are derived rather than written down.
   *
   * `readFields` is imported and re-derived here rather than a list of expected
   * names being typed out, so a field added to a block schema tomorrow is a
   * field this test immediately demands. A hardcoded form for the hero that
   * forgot `subhead` fails here.
   */
  test('offers a control for every field of every block in the template', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    const expected: string[] = []

    for (const [id, type] of [
      ['hero', 'hero'],
      ['event-details', 'details'],
      ['countdown', 'countdown'],
      ['venue-map', 'map'],
      ['rsvp', 'rsvp-form'],
    ] as const) {
      for (const field of readFields(BLOCK_CONFIG_SCHEMAS[type])) {
        // Rows and pictures name their controls one level down; the leaves are
        // what a browser can be asked about, so this checks the leaves.
        if (field.control.kind === 'rows') {
          for (const inner of field.control.fields) {
            expected.push(`block:${id}.${field.key}.0.${inner.key}`)
          }
          continue
        }
        if (field.control.kind === 'group') {
          for (const inner of field.control.fields) {
            expected.push(`block:${id}.${field.key}.${inner.key}`)
          }
          continue
        }
        if (field.control.kind === 'picture') {
          expected.push(`block:${id}.${field.key}.upload`)
          for (const inner of field.control.fields) {
            expected.push(`block:${id}.${field.key}.${inner.key}`)
          }
          continue
        }
        expected.push(`block:${id}.${field.key}`)
      }
    }

    expect(expected.length).toBeGreaterThan(20)

    for (const name of expected) {
      await expect(page.locator(`[name="${name}"]`).first(), `no control for ${name}`).toHaveCount(
        1
      )
    }
  })

  test('draws the envelope beside the blocks, from its own schema', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await page.fill('[name="envelope.note"]', 'Save the date')
    await page.fill('[name="envelope.openLabel"]', 'Open me')

    await save(page, 'Save the invitation')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    await page.goto(`/e/${fixture.event.slug}`)
    await expect(page.locator('[data-envelope-note]')).toHaveText('Save the date')
    await expect(page.locator('[data-envelope-prompt]')).toHaveText('Open me')

    const content = await publishedContent(fixture.event.eventId)
    // Beside the blocks and never inside them: the cover has no block id.
    expect(content.envelope).toEqual({ note: 'Save the date', openLabel: 'Open me' })
  })
})

test.describe('a save that would break the page', () => {
  test('is refused, names the field, and leaves the guest page as it was', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    const headline = page.locator('[name="block:hero.headline"]')
    const before = await headline.inputValue()

    // Required in the browser as well, so the attribute has to go before the
    // form will submit at all. That is the point: the server is what refuses
    // it, and this proves the server refuses it rather than the browser.
    await headline.evaluate((element) => element.removeAttribute('required'))
    await headline.fill('')

    await save(page, 'Save the invitation')

    await expect(page.locator('[data-save-status="failed"]')).toBeVisible()
    await expect(page.locator('[data-save-issues]')).toContainText('blocks.hero.headline')

    await page.goto(`/e/${fixture.event.slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(before)
  })
})

test.describe('swapping a photo', () => {
  test('puts an uploaded photograph on the invitation, at every stored width', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await page.setInputFiles('[data-picture-input="block:hero.image"]', {
      name: 'us.jpg',
      mimeType: 'image/jpeg',
      buffer: photographBytes(),
    })

    // The upload happens on its own, before the save: the form carries the id
    // of the row it produced and never an address a browser could choose.
    await expect(page.locator('[data-picture-preview="block:hero.image"]')).toBeVisible()
    await expect(page.locator('[name="block:hero.image.upload"]')).not.toHaveValue('')

    await page.fill('[name="block:hero.image.alt"]', 'The two of us on the beach')
    await save(page, 'Save the invitation')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    const content = await publishedContent(fixture.event.eventId)
    const blocks = content.blocks as Record<string, Record<string, unknown>>
    const image = blocks.hero?.image as { src: string; widths: { width: number }[]; alt: string }

    // `/a/<key>` and never a hostname: the hostname is a property of the
    // deployment and is applied at render time (src/lib/uploads/host.ts).
    expect(image.src.startsWith('/a/')).toBe(true)
    expect(image.alt).toBe('The two of us on the beach')
    /*
     * Two widths and not three, because the sample photograph is 1500 pixels
     * wide and the capability does not upscale: `plannedWidths` keeps every
     * plan at or below the source. What matters is that the content names every
     * width that was actually stored, so nothing is paid for and never served.
     */
    expect(image.widths.map((width) => width.width)).toEqual([480, 960])

    await page.goto(`/e/${fixture.event.slug}`)
    const photo = page.getByAltText('The two of us on the beach')
    await expect(photo).toBeVisible()

    // The smallest width is what a browser too old to read srcset fetches, and
    // that browser is on the slowest phone in the room.
    await expect(photo).toHaveAttribute('src', /^\/a\/.+-w480\.webp$/)
    await expect(photo).toHaveAttribute('srcset', /480w.+960w/)
  })
})

test.describe('the reply form', () => {
  test('stops asking a question without losing the replies already given to it', async ({
    page,
  }) => {
    const fixture = await freshEvent()

    // A guest answers first, so what is at stake when the question is removed
    // is a real row rather than a hypothetical one.
    await page.goto(`/e/${fixture.event.slug}`)
    await openEnvelope(page)
    await page.getByLabel(GUEST_QUESTION_PROMPTS.name as string).fill('Ada Ashgrove')
    await page
      .getByLabel(GUEST_QUESTION_PROMPTS.dietary as string)
      .fill('Coeliac, and no shellfish')
    await page.getByRole('button', { name: /send/i }).click()
    await expect(page.getByText(/thank you/i)).toBeVisible()

    await openEditor(page, fixture)

    const dietary = page
      .locator('[data-question]')
      .filter({ hasText: GUEST_QUESTION_PROMPTS.dietary as string })
    await dietary.locator('input[name^="ask:"]').uncheck()

    await save(page, 'Save the reply form')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    // Gone from the form a guest fills in.
    await page.goto(`/e/${fixture.event.slug}`)
    await openEnvelope(page)
    await expect(page.getByLabel(GUEST_QUESTION_PROMPTS.dietary as string)).toHaveCount(0)

    /*
     * And still in the replies. `rsvp_answers` references the question ON
     * DELETE RESTRICT and `authenticated` holds no DELETE on questions at all,
     * so removing one is `retired_at` and the answer keeps the prompt it was
     * asked under.
     */
    await page.goto(`/dashboard/${fixture.event.eventId}/replies`)
    await expect(page.getByText('Coeliac, and no shellfish')).toBeVisible()
  })

  test('makes a question one a guest must answer', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    const email = page
      .locator('[data-question]')
      .filter({ hasText: GUEST_QUESTION_PROMPTS.email as string })
    await email.locator('input[name^="required:"]').check()

    await save(page, 'Save the reply form')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    await page.goto(`/e/${fixture.event.slug}`)
    await openEnvelope(page)

    await expect(page.getByLabel(GUEST_QUESTION_PROMPTS.email as string)).toHaveAttribute(
      'required',
      ''
    )
  })

  test('offers no way to write a question of its own', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    /*
     * Not an oversight, and asserted so it stays deliberate. Every question
     * carries a `pii_class` that decides what the retention sweep erases, and a
     * question in a buyer's own words is a question somebody has to classify.
     * See docs/editing.md and the open decision it names.
     */
    await expect(page.getByText('Writing your own is not available yet.')).toBeVisible()
    await expect(page.locator('[name^="prompt:"]')).toHaveCount(0)
  })
})

test.describe('the editor on a phone', () => {
  /**
   * Not the 320px contract the guest pages carry, which is about guests
   * arriving from a chat link on an old phone. This is a plainer fact: buyers
   * fill this in on the same phone they read the Etsy listing on, and a form
   * that scrolls sideways is a form where half the fields are off screen.
   */
  test('does not scroll sideways at the narrowest supported width', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-320', 'this is the narrow width run')

    const fixture = await freshEvent()
    await openEditor(page, fixture)

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
})

test.describe('another buyer’s invitation', () => {
  test('cannot be opened, and says the same thing as one that does not exist', async ({ page }) => {
    const mine = await freshEvent()
    const theirs = await freshEvent()

    await signIn(page, mine.ownerEmail)

    const found = await page.goto(`/dashboard/${theirs.event.eventId}/edit`)
    expect(found?.status()).toBe(404)

    const missing = await page.goto('/dashboard/00000000-0000-4000-8000-000000000000/edit')
    expect(missing?.status()).toBe(404)
  })
})
