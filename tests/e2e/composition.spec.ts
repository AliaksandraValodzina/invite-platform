import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { resolveSeedConfig, type SeededEvent } from '../../scripts/seed-event'
import { CURRENT_CONTENT_VERSION } from '../../src/lib/template/content.ts'
import { CURRENT_THEME_VERSION } from '../../src/lib/template/theme.ts'
import { signIn } from '../support/auth'
import { openEnvelope } from '../support/envelope'
import { GUEST_CONTENT, GUEST_VENUE, seedGuestEvent } from '../support/events'

/**
 * The other half of editing: which sections an invitation has, in what order,
 * and in what colours.
 *
 * Every assertion reads the page a GUEST gets. An editor that says "Saved" and
 * changes nothing is the bug this suite exists for, and it is invisible to a
 * test that only looks at the panel the buyer pressed.
 *
 * The composition assertions read `data-block-id` off the guest page in document
 * order, which is the thing a guest experiences: not that a section is absent,
 * but that the page reads hero, then countdown, then the reply form.
 *
 * One event and one buyer per test. A magic link is a one-use token stored
 * against the auth user, so two tests signing in as one buyer take turns being
 * logged out.
 */

const config = resolveSeedConfig()

type Fixture = { readonly event: SeededEvent; readonly ownerEmail: string }

async function freshEvent(options: { readonly themeOverride?: unknown } = {}): Promise<Fixture> {
  const ownerEmail = `composer-${randomUUID()}@example.test`
  return {
    event: await seedGuestEvent('live', { ownerEmail, ...options }),
    ownerEmail,
  }
}

async function openEditor(page: Page, fixture: Fixture): Promise<void> {
  await signIn(page, fixture.ownerEmail)
  await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
  await expect(page.getByRole('button', { name: 'Save the invitation' })).toBeVisible()
}

/** Presses one composition control and waits for the panel to say what happened. */
async function compose(page: Page, control: string): Promise<void> {
  await page.getByRole('button', { name: control, exact: true }).click()
  await expect(page.locator('[data-save-status]').first()).toBeVisible()
}

/** The sections a guest reads, in the order they read them. */
async function guestSections(page: Page, slug: string): Promise<string[]> {
  await page.goto(`/e/${slug}`)
  await openEnvelope(page)
  return page
    .locator('[data-block-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-block-id') ?? ''))
}

/** The published content revision, read with the service role. */
async function publishedRevision(
  eventId: string
): Promise<{ content: Record<string, unknown>; theme: Record<string, unknown> }> {
  const response = await fetch(
    `${config.url}/rest/v1/event_content?event_id=eq.${eventId}&is_published=is.true&select=content,theme`,
    { headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` } }
  )

  const rows = (await response.json()) as {
    content: Record<string, unknown>
    theme: Record<string, unknown>
  }[]

  const row = rows[0]
  if (row === undefined) throw new Error(`event ${eventId} has no published content revision`)
  return row
}

test.describe('a buyer composes their invitation', () => {
  test('takes a section out, and a guest stops reading it', async ({ page }) => {
    const fixture = await freshEvent()

    expect(await guestSections(page, fixture.event.slug)).toEqual([
      'hero',
      'event-details',
      'countdown',
      'venue-map',
      'rsvp',
    ])
    await expect(page.getByText(GUEST_VENUE)).toBeVisible()

    await openEditor(page, fixture)
    await compose(page, 'Remove Countdown')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    expect(await guestSections(page, fixture.event.slug)).toEqual([
      'hero',
      'event-details',
      'venue-map',
      'rsvp',
    ])
  })

  test('moves a section, and a guest reads them in the new order', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await compose(page, 'Move Countdown up')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    expect(await guestSections(page, fixture.event.slug)).toEqual([
      'hero',
      'countdown',
      'event-details',
      'venue-map',
      'rsvp',
    ])
  })

  /**
   * The question the stage brief asked to be decided rather than assumed, walked
   * end to end: removing a section keeps what the buyer wrote in it, and putting
   * it back brings it with them.
   *
   * The seeded fixture stores a real venue and address on the map section, so
   * what comes back is the buyer's own words rather than the template's
   * placeholder ones. That distinction is the whole assertion: a page showing
   * the template's default venue after a restore would look like it worked.
   */
  test('puts a removed section back with every word still in it', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    /*
     * The map holds the venue and the address, which is a load bearing detail
     * (docs/activation.md), so removing it from an invitation with replies would
     * stop and ask. This fixture has none, so it saves straight away, and the
     * asking is covered where the rest of that behaviour is.
     */
    await compose(page, 'Remove Map')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    let sections = await guestSections(page, fixture.event.slug)
    expect(sections).not.toContain('venue-map')
    await expect(page.getByText(GUEST_VENUE)).toHaveCount(0)

    // The words are still in the row while the section is off the page.
    const removed = await publishedRevision(fixture.event.eventId)
    expect((removed.content.blocks as Record<string, unknown>)['venue-map']).toEqual(
      (GUEST_CONTENT.blocks as Record<string, unknown>)['venue-map']
    )

    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await expect(page.locator('[data-removed-section="venue-map"]')).toBeVisible()

    await compose(page, 'Put Map back')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    sections = await guestSections(page, fixture.event.slug)
    expect(sections).toContain('venue-map')
    // Last, because that is where "put it back" says it goes.
    expect(sections[sections.length - 1]).toBe('venue-map')
    await expect(page.getByText(GUEST_VENUE)).toBeVisible()
    await expect(page.getByText('14 Orangery Lane')).toBeVisible()
  })

  test('stores no section list at all when the order is the template order', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await compose(page, 'Move Countdown up')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()
    expect((await publishedRevision(fixture.event.eventId)).content.sections).toEqual([
      'hero',
      'countdown',
      'event-details',
      'venue-map',
      'rsvp',
    ])

    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await compose(page, 'Move Countdown down')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    /*
     * Back to the template's own order, so nothing is stored. Storing the
     * equivalent list would quietly stop this event ever receiving a section the
     * template gains later, which is the same failure as an editor that wrote
     * merged configs back instead of overrides.
     */
    expect((await publishedRevision(fixture.event.eventId)).content.sections).toBeUndefined()
  })

  test('refuses to leave an invitation with nothing on it', async ({ page }) => {
    const fixture = await freshEvent()
    await signIn(page, fixture.ownerEmail)

    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await compose(page, 'Remove Details')
    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await compose(page, 'Remove Countdown')
    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await compose(page, 'Remove Map')
    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await compose(page, 'Remove RSVP form')
    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await compose(page, 'Remove Hero')

    await expect(page.locator('[data-save-status="failed"]')).toContainText(
      'An invitation needs at least one section'
    )
    expect(await guestSections(page, fixture.event.slug)).toEqual(['hero'])
  })

  /**
   * Taking the venue and the address off a page twelve people have already
   * replied to is the same harm as changing them, expressed as a change to
   * nothing. So a removal that empties a load bearing detail asks, with the
   * count, exactly the way an edit to it does.
   *
   * Moving a section does not ask, and neither does putting one back: the same
   * facts in a different order are the same facts, and a restore adds
   * information rather than taking it away.
   */
  test('asks before taking the venue off an invitation somebody has replied to', async ({
    page,
  }) => {
    const fixture = await freshEvent()

    // A real reply, through the real form, so the count is a real count.
    await page.goto(`/e/${fixture.event.slug}`)
    await openEnvelope(page)
    await page.getByLabel('Your name').fill('Marguerite Okonkwo')
    await page.getByRole('button', { name: 'Send our reply' }).click()
    await expect(page.getByTestId('rsvp-success')).toBeVisible()

    await openEditor(page, fixture)

    // Reordering is not a load bearing change, so it saves straight through.
    await compose(page, 'Move Map up')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await page.getByRole('button', { name: 'Remove Map', exact: true }).click()

    await expect(page.getByTestId('confirm-message')).toContainText('1 person has')
    await expect(page.getByTestId('confirm-changes')).toContainText('The venue')
    await expect(page.getByTestId('confirm-changes')).toContainText(GUEST_VENUE)

    // Nothing was written while the question was on screen.
    expect(await guestSections(page, fixture.event.slug)).toContain('venue-map')

    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await page.getByRole('button', { name: 'Remove Map', exact: true }).click()
    await page.getByRole('button', { name: 'Change it anyway' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    expect(await guestSections(page, fixture.event.slug)).not.toContain('venue-map')
  })

  test('says so when the invitation is live and there is no draft to hide behind', async ({
    page,
  }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await expect(page.locator('[data-testid="composition-live"]')).toContainText(
      'what guests see the moment you make it'
    )
  })

  /*
   * The design catalogue is the other half of this stage and is gated on an
   * open decision about authoring capacity. What must not happen in the
   * meantime is a picker with nothing behind it, so the empty state says what
   * is true rather than offering a choice the product cannot honour.
   */
  test('offers nothing to add on an invitation nothing has been taken out of', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await expect(page.locator('[data-testid="nothing-removed"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Put .* back$/ })).toHaveCount(0)
  })
})

test.describe('a buyer chooses their own colours', () => {
  test('picks a palette, and a guest page is drawn in it', async ({ page }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await page.fill('[name="colour.bg"]', '#101820')
    await page.fill('[name="colour.surface"]', '#1b2430')
    await page.fill('[name="colour.ink"]', '#f4f1ea')
    await page.fill('[name="colour.inkMuted"]', '#c4bfb4')
    await page.fill('[name="colour.accent"]', '#c9a227')
    await page.fill('[name="colour.border"]', '#2b3542')
    await page.fill('[name="colour.critical"]', '#ff8f7a')
    await page.check('[name="accentInk"][value="bg"]')

    await page.getByRole('button', { name: 'Save the colours' }).click()
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    await page.goto(`/e/${fixture.event.slug}`)
    const background = await page
      .locator('[data-theme-scope]')
      .evaluate((node) => getComputedStyle(node).backgroundColor)

    expect(background).toBe('rgb(16, 24, 32)')

    const stored = await publishedRevision(fixture.event.eventId)
    expect((stored.theme.tokens as Record<string, Record<string, string>>).color?.bg).toBe(
      '#101820'
    )
    // The words were not resent, so they have to have come forward on their own.
    expect((stored.content.blocks as Record<string, Record<string, string>>).hero?.headline).toBe(
      (GUEST_CONTENT.blocks as Record<string, Record<string, string>>).hero?.headline
    )
  })

  /**
   * The behaviour the stage was told to use rather than replace: a stored
   * palette this deploy cannot read degrades to the template's and reports it.
   *
   * Seeded directly, because the form cannot produce it: every control is a
   * colour input and `accentInk` is a choice rather than a swatch. That is the
   * point of the test. The read path has to keep an invitation on screen
   * whatever is in that column, since the column is the one place a palette can
   * arrive from a version of this product that is not this one.
   */
  test('still renders the invitation when the stored palette is not readable', async ({ page }) => {
    const fixture = await freshEvent({
      themeOverride: {
        version: CURRENT_THEME_VERSION,
        tokens: { color: { bg: 'not-a-colour' } },
      },
    })

    await page.goto(`/e/${fixture.event.slug}`)
    await openEnvelope(page)

    // The invitation, not a notice: the couple's own words are on screen.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wilhelmina & Bartholomew')

    // In the template's colours, which is what the fallback means.
    const background = await page
      .locator('[data-theme-scope]')
      .evaluate((node) => getComputedStyle(node).backgroundColor)
    expect(background).toBe('rgb(243, 241, 236)')

    // And the buyer is told, on the page where it can be repaired, with what
    // they stored still stored.
    await signIn(page, fixture.ownerEmail)
    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await expect(page.locator('[data-testid="palette-rejected"]')).toBeVisible()

    const stored = await publishedRevision(fixture.event.eventId)
    expect((stored.theme.tokens as Record<string, Record<string, string>>).color?.bg).toBe(
      'not-a-colour'
    )
  })

  test('goes back to the template colours, and the invitation follows the template again', async ({
    page,
  }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await page.fill('[name="colour.accent"]', '#2f6f4f')
    await page.getByRole('button', { name: 'Save the colours' }).click()
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    await page.goto(`/dashboard/${fixture.event.eventId}/edit`)
    await page.getByRole('button', { name: "Go back to the template's colours" }).click()
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    const stored = await publishedRevision(fixture.event.eventId)
    expect(stored.theme).toEqual({ version: CURRENT_THEME_VERSION, tokens: {} })
  })
})

test.describe('the shape a composition is stored in', () => {
  test('is a list of block ids inside the content document, at the current version', async ({
    page,
  }) => {
    const fixture = await freshEvent()
    await openEditor(page, fixture)

    await compose(page, 'Remove Countdown')
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible()

    const stored = await publishedRevision(fixture.event.eventId)
    expect(stored.content.version).toBe(CURRENT_CONTENT_VERSION)
    expect(stored.content.sections).toEqual(['hero', 'event-details', 'venue-map', 'rsvp'])
  })
})
