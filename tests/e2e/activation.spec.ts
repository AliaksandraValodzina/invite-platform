import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { openEnvelope } from '../support/envelope'
import { createSignInLink, signIn } from '../support/auth'
import {
  ensureBuyerAccount,
  eventsForTemplate,
  mintClaimLink,
  readCode,
  rest,
  seedPreviewTemplate,
} from '../support/activation'
import { seedGuestEvent } from '../support/events'

/**
 * The loop this stage exists to close: an Etsy order becomes a live invitation
 * with the captain not in the middle.
 *
 * Two links and they are never the same link. `/claim/<code>` is single use,
 * makes the buyer's own copy, and is delivered privately. `/t/<templateId>` is
 * public, renders a design and creates nothing. A test that only walked the
 * happy claim would not notice the two being confused, so the preview's
 * assertion is that the events table did not grow.
 *
 * Two places this flow breaks, and both are walked as first class paths rather
 * than as afterthoughts:
 *
 *   the token surviving sign-in  a buyer arriving signed in with nothing to
 *                                show for a purchase has, as far as they can
 *                                tell, paid and received nothing
 *   the second click             a double tap on a phone must open the
 *                                invitation they already have, never a spent
 *                                code error
 *
 * One buyer per test, and a fresh address each time. A magic link is a one-use
 * token stored against the auth user, so two tests sharing a buyer take turns
 * being signed out; the replies suite found that the hard way.
 */

/** A buyer nobody else in this run shares. See tests/e2e/editing.spec.ts. */
function freshBuyer(): string {
  return `buyer-${randomUUID()}@example.test`
}

const EDITOR_URL = /\/dashboard\/[0-9a-f-]{36}\/edit/

function eventIdFrom(url: string): string {
  const match = /\/dashboard\/([0-9a-f-]{36})\/edit/.exec(url)
  if (match === null) throw new Error(`not an editor URL: ${url}`)
  return match[1] as string
}

test.describe('claiming an invitation', () => {
  test('a signed-out buyer clicks the link, signs in, and lands in their own editor', async ({
    page,
  }) => {
    const minted = await mintClaimLink()
    const email = freshBuyer()

    // 1. The link out of the order message, opened by somebody with no session.
    await page.goto(minted.claimPath)
    await expect(page.getByTestId('claim-ready')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send me a link' })).toBeVisible()

    // Nothing has been spent by looking at it. A link scanner in a mail client
    // or a chat preview reaches exactly this, and must not consume a purchase.
    expect((await readCode(minted.codeId)).status).toBe('issued')

    // 2. The mailbox round trip. The account is created here rather than by the
    //    auth API because the local stack has no mailer; see tests/support/activation.ts.
    await ensureBuyerAccount(email)
    await page.goto(await createSignInLink(email, { next: minted.claimPath }))

    // 3. Signed in, and looking at their own editable copy.
    await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]{36}\/edit\?claimed=1/)
    await expect(page.getByTestId('just-claimed')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save the invitation' })).toBeVisible()

    const eventId = eventIdFrom(page.url())

    // The code is spent, and it names the event it made.
    const spent = await readCode(minted.codeId)
    expect(spent.status).toBe('redeemed')
    expect(spent.redeemed_event_id).toBe(eventId)

    // It is theirs, unpublished, and the hosting term came off the code.
    const rows = (await rest(
      `events?id=eq.${eventId}&select=status,hosting_expires_at,template_id`
    )) as { status: string; hosting_expires_at: string; template_id: string }[]

    expect(rows[0]?.status).toBe('draft')
    expect(rows[0]?.template_id).toBe(minted.templateId)

    const months =
      (new Date(rows[0]?.hosting_expires_at ?? 0).getTime() - Date.now()) / (86_400_000 * 30.4)
    expect(months).toBeGreaterThan(11)
    expect(months).toBeLessThan(13)

    // Editable is the claim, so it is edited. The reply form is drawn from rows
    // the claim created, so an empty question set would show up here.
    await expect(page.getByRole('button', { name: 'Save the reply form' })).toBeVisible()
    await expect(page.locator('[data-question]').first()).toBeVisible()
  })

  test('the claim survives sign-in even when the link loses its query', async ({ page }) => {
    /*
     * The other carrier. A mail provider that rewrites links, or an auth
     * redirect allow list that does not admit a query string, both drop
     * `?next=`. The cookie set when the buyer asked for the link is what is left,
     * and it has to be enough.
     */
    const minted = await mintClaimLink()
    const email = freshBuyer()
    await ensureBuyerAccount(email)

    await page.goto(minted.claimPath)
    await page.getByLabel('Email address').fill(email)
    await page.getByRole('button', { name: 'Send me a link' }).click()

    // Whether the send itself succeeded depends on the mailer, which the local
    // stack does not have. What is asserted is the note the browser now holds.
    await expect(
      page.locator('[data-testid="claim-link-sent"], [data-testid="claim-error"]')
    ).toBeVisible()

    await page.goto(await createSignInLink(email))

    await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]{36}\/edit\?claimed=1/)
    expect((await readCode(minted.codeId)).status).toBe('redeemed')
  })

  test('a second click opens the invitation they already have', async ({ page }) => {
    const minted = await mintClaimLink()
    const email = freshBuyer()
    await ensureBuyerAccount(email)

    await page.goto(await createSignInLink(email, { next: minted.claimPath }))
    await expect(page).toHaveURL(EDITOR_URL)
    const first = eventIdFrom(page.url())

    await page.goto(minted.claimPath)

    await expect(page).toHaveURL(EDITOR_URL)
    expect(eventIdFrom(page.url())).toBe(first)

    // Not a spent-code error, and not a second invitation. Both of those read
    // to somebody who has just paid as having lost the purchase.
    await expect(page.getByTestId('claim-already')).toHaveCount(0)
    await expect(page.getByTestId('claim-unknown')).toHaveCount(0)
    expect(await eventsForTemplate(minted.templateId)).toHaveLength(1)
  })

  test('a double tap on a phone makes one invitation, not two', async ({ page }) => {
    const minted = await mintClaimLink()
    const email = freshBuyer()
    await ensureBuyerAccount(email)

    await signIn(page, email)

    /*
     * Two requests in flight at once, which is what a double tap actually is.
     * The claim is a compare and set on `status=eq.issued`, so one wins and the
     * other takes its own event back and follows the winner.
     */
    const [one, two] = await Promise.all([
      page.request.get(minted.claimPath),
      page.request.get(minted.claimPath),
    ])

    expect(one.ok()).toBe(true)
    expect(two.ok()).toBe(true)
    expect(eventIdFrom(one.url())).toBe(eventIdFrom(two.url()))
    expect(await eventsForTemplate(minted.templateId)).toHaveLength(1)
  })

  test('a link claimed on somebody else account says so rather than making a second one', async ({
    page,
  }) => {
    const minted = await mintClaimLink()
    const first = freshBuyer()
    const second = freshBuyer()
    await ensureBuyerAccount(first)
    await ensureBuyerAccount(second)

    await page.goto(await createSignInLink(first, { next: minted.claimPath }))
    await expect(page).toHaveURL(EDITOR_URL)

    await page.goto(await createSignInLink(second))
    await page.goto(minted.claimPath)

    await expect(page.getByTestId('claim-other-account')).toBeVisible()
    expect(await eventsForTemplate(minted.templateId)).toHaveLength(1)
  })

  test('a made-up link is told it is not a claim link, and costs nothing', async ({ page }) => {
    await page.goto('/claim/AB4CD-9EFGH-JKMNP-QRSTV')

    await expect(page.getByTestId('claim-unknown')).toBeVisible()
    // Not "already used". Somebody who mistyped a link and somebody whose
    // purchase was consumed need different sentences.
    await expect(page.getByTestId('claim-already')).toHaveCount(0)
  })

  test('an expired link says nothing is lost, and stays unspent', async ({ page }) => {
    const minted = await mintClaimLink({ expiresAt: '2020-01-01T00:00:00Z' })
    const email = freshBuyer()
    await ensureBuyerAccount(email)

    await signIn(page, email)
    await page.goto(minted.claimPath)

    await expect(page.getByTestId('claim-lapsed')).toBeVisible()
    expect((await readCode(minted.codeId)).status).toBe('issued')
    expect(await eventsForTemplate(minted.templateId)).toHaveLength(0)
  })
})

test.describe('the public preview', () => {
  test('renders a template and creates nothing', async ({ page }) => {
    const { templateId } = await seedPreviewTemplate()

    expect(await eventsForTemplate(templateId)).toHaveLength(0)

    await page.goto(`/t/${templateId}`)
    await openEnvelope(page)

    // The template's own words, drawn through the same resolve the guest page
    // uses. A preview that rendered something else would not be a preview.
    await expect(page.locator('[data-block-id]').first()).toBeVisible()
    await expect(page.getByTestId('template-preview-footer')).toBeVisible()

    // The whole of the claim: it made nothing.
    expect(await eventsForTemplate(templateId)).toHaveLength(0)
  })

  test('takes no reply, and says why rather than pretending', async ({ page }) => {
    const { templateId } = await seedPreviewTemplate()

    await page.goto(`/t/${templateId}`)
    await openEnvelope(page)

    await page.getByLabel('Your name').fill('Marguerite Okonkwo')
    await page.getByRole('button', { name: 'Send RSVP' }).click()

    await expect(page.getByTestId('rsvp-error')).toContainText('preview of a template')
    // Never the success message. Telling somebody their reply was sent when no
    // such reply exists is the worst lie this product could tell.
    await expect(page.getByTestId('rsvp-success')).toHaveCount(0)
    // And nothing was created to hang a reply on in the first place.
    expect(await eventsForTemplate(templateId)).toHaveLength(0)
  })

  test('is meant to spread, so it is not marked noindex', async ({ page }) => {
    const { templateId } = await seedPreviewTemplate()

    await page.goto(`/t/${templateId}`)

    // The opposite decision to a guest page, which carries a couple's names and
    // was shared into a chat rather than published.
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0)
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
  })

  test('an unpublished template is not previewable', async ({ page }) => {
    const { templateId, issuerId } = await seedPreviewTemplate()
    await draftTemplate(templateId, issuerId)

    const response = await page.goto(`/t/${templateId}`)

    expect(response?.status()).toBe(404)
  })
})

test.describe('publishing', () => {
  test('publish and unpublish are both visible from the guest side', async ({ page }) => {
    const minted = await mintClaimLink()
    const email = freshBuyer()
    await ensureBuyerAccount(email)

    await page.goto(await createSignInLink(email, { next: minted.claimPath }))
    await expect(page).toHaveURL(EDITOR_URL)

    const eventId = eventIdFrom(page.url())
    const slug = await slugFor(eventId)
    const editor = `/dashboard/${eventId}/edit`

    // Before: the designed notice, not the invitation and not a 404.
    await page.goto(`/e/${slug}`)
    await expect(page.getByTestId('guest-notice')).toBeVisible()

    await page.goto(editor)
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    await page.goto(`/e/${slug}`)
    await openEnvelope(page)
    await expect(page.locator('[data-block-id]').first()).toBeVisible()
    await expect(page.getByTestId('guest-notice')).toHaveCount(0)

    await page.goto(editor)
    await page.getByRole('button', { name: 'Take it down' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    await page.goto(`/e/${slug}`)
    await expect(page.getByTestId('guest-notice')).toBeVisible()
  })

  test('the link follows the title until publication, and is fixed afterwards', async ({
    page,
  }) => {
    const minted = await mintClaimLink()
    const email = freshBuyer()
    await ensureBuyerAccount(email)

    await page.goto(await createSignInLink(email, { next: minted.claimPath }))
    await expect(page).toHaveURL(EDITOR_URL)
    const eventId = eventIdFrom(page.url())

    // Claimed under a placeholder, because nobody knew the couple's names when
    // the code was spent.
    expect(await slugFor(eventId)).toMatch(/^your-invitation-/)

    await page.locator('[name="title"]').fill('Wilhelmina and Bartholomew')
    await page.getByRole('button', { name: 'Save the details' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    const named = await slugFor(eventId)
    expect(named).toMatch(/^wilhelmina-and-bartholomew-/)

    await page.reload()
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    // Frozen. Every share that has gone out points at this, and there is no way
    // to reach those people and correct it.
    await page.reload()
    await page.locator('[name="title"]').fill('Changed our minds entirely')
    await page.getByRole('button', { name: 'Save the details' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    expect(await slugFor(eventId)).toBe(named)
  })
})

test.describe('the load bearing detail warning', () => {
  test('changing the date on an invitation with replies asks first, then allows it', async ({
    page,
  }) => {
    const ownerEmail = freshBuyer()
    const event = await seedGuestEvent('live', { ownerEmail })

    // A real reply, given through the real form, so the count is a real count.
    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)
    await page.getByLabel('Your name').fill('Marguerite Okonkwo')
    await page.getByRole('button', { name: 'Send our reply' }).click()
    await expect(page.getByTestId('rsvp-success')).toBeVisible()

    await signIn(page, ownerEmail)
    await page.goto(`/dashboard/${event.eventId}/edit`)

    await moveTheDate(page, '2027-03-21')
    await page.getByRole('button', { name: 'Save the details' }).click()

    // Asked, with the count, and nothing written.
    await expect(page.getByTestId('confirm-message')).toContainText('1 person has')
    await expect(page.getByTestId('confirm-changes')).toContainText('The date and time')
    expect(await startsAtFor(event.eventId)).toContain('2027-03-14')

    // A confirmation and never a block: the buyer may go ahead.
    await page.getByRole('button', { name: 'Change it anyway' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    expect(await startsAtFor(event.eventId)).toContain('2027-03-21')
  })

  test('changing the venue asks, and changing the heading above it does not', async ({ page }) => {
    const ownerEmail = freshBuyer()
    const event = await seedGuestEvent('live', { ownerEmail })

    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)
    await page.getByLabel('Your name').fill('Marguerite Okonkwo')
    await page.getByRole('button', { name: 'Send our reply' }).click()
    await expect(page.getByTestId('rsvp-success')).toBeVisible()

    await signIn(page, ownerEmail)
    await page.goto(`/dashboard/${event.eventId}/edit`)

    // Not on the list: the same form, saved without a question.
    await page.locator('[name="block:venue-map.heading"]').fill('Getting there')
    await page.getByRole('button', { name: 'Save the invitation' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    await page.reload()
    await page.locator('[name="block:venue-map.venueName"]').fill('The Ashgrove Boathouse')
    await page.getByRole('button', { name: 'Save the invitation' }).click()

    await expect(page.getByTestId('confirm-changes')).toContainText('The venue')
    await expect(page.getByTestId('confirm-changes')).toContainText('The Ashgrove Boathouse')

    await page.getByRole('button', { name: 'Change it anyway' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    // The value a guest reads, which is the only place this is worth asserting.
    await page.goto(`/e/${event.slug}`)
    await openEnvelope(page)
    await expect(page.getByText('The Ashgrove Boathouse')).toBeVisible()
  })

  test('an invitation with no replies saves the date without asking', async ({ page }) => {
    const ownerEmail = freshBuyer()
    const event = await seedGuestEvent('live', { ownerEmail })

    await signIn(page, ownerEmail)
    await page.goto(`/dashboard/${event.eventId}/edit`)

    await moveTheDate(page, '2027-03-21')
    await page.getByRole('button', { name: 'Save the details' }).click()

    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()
    await expect(page.locator('[data-save-status="confirm"]')).toHaveCount(0)
    expect(await startsAtFor(event.eventId)).toContain('2027-03-21')
  })
})

// Helpers ---------------------------------------------------------------------

/**
 * Moves the whole day, start and end together.
 *
 * The seeded fixture runs from four in the afternoon until half past eleven on
 * the same date, and `saveDetails` refuses an end before its start. Moving only
 * the start would be testing that refusal rather than the confirmation.
 */
async function moveTheDate(page: Page, date: string): Promise<void> {
  await page.locator('[name="startDate"]').fill(date)
  await page.locator('[name="endDate"]').fill(date)
}

async function slugFor(eventId: string): Promise<string> {
  const rows = (await rest(`events?id=eq.${eventId}&select=slug`)) as { slug: string }[]
  const row = rows[0]
  if (row === undefined) throw new Error(`no event ${eventId}`)
  return row.slug
}

async function startsAtFor(eventId: string): Promise<string> {
  const rows = (await rest(`events?id=eq.${eventId}&select=starts_at_local`)) as {
    starts_at_local: string
  }[]
  const row = rows[0]
  if (row === undefined) throw new Error(`no event ${eventId}`)
  return row.starts_at_local
}

async function draftTemplate(templateId: string, ownerId: string): Promise<void> {
  const { resolveSeedConfig } = await import('../../scripts/seed-event')
  const config = resolveSeedConfig()

  const response = await fetch(`${config.url}/rest/v1/templates?id=eq.${templateId}`, {
    method: 'PATCH',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ status: 'draft' }),
  })

  if (!response.ok) {
    throw new Error(`could not draft template ${templateId} of ${ownerId}: ${response.status}`)
  }
}
