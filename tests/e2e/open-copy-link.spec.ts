import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { templateCopyPath, templatePreviewPath } from '@/lib/activation/code'
import { createSignInLink, signIn } from '../support/auth'
import {
  ensureBuyerAccount,
  eventsForTemplate,
  rest,
  seedPreviewTemplate,
} from '../support/activation'
import { openEnvelope } from '../support/envelope'

/**
 * One link anyone can open, copy and make their own: the free launch.
 *
 * The captain's decision of 2026-08-24, in their words: "LET'S MAKE one link
 * for all for now", paired with releasing the first template free. Canva's
 * shape. The reason to take it is not the shape but the distribution: a link
 * that has to stay secret to be safe is not a link you can put on an Etsy
 * listing.
 *
 * **This route is deliberately temporary.** An open copy link plus a price is a
 * free product, so it must not still be the active route when the first PAID
 * listing publishes. `/claim/<code>` is untouched and is the paid route, and
 * tests/e2e/activation.spec.ts still walks it.
 *
 * Three things this file exists to hold, in the order they would be lost:
 *
 *   1. A visitor who is not signed in still sees the whole invitation. The
 *      preview is the sales pitch, and sign-in in front of it is a door in
 *      front of the shop window.
 *   2. Signing in to copy returns them TO THE COPY, not to a dashboard. The
 *      sign-in step is where people are lost, and somebody who lands on an
 *      empty dashboard does not press "make this mine" a second time.
 *   3. One published invitation at a time per account still holds for an event
 *      created through this route. With an open copy link that limit is the
 *      only thing between one free template and somebody running a wedding
 *      business on it, and a copy minted by a new route is exactly the kind of
 *      thing that walks past a guard written for a different one.
 */

/** A visitor nobody else in this run shares. See tests/e2e/activation.spec.ts. */
function freshVisitor(): string {
  return `copy-${randomUUID()}@example.test`
}

const EDITOR_URL = /\/dashboard\/[0-9a-f-]{36}\/edit/

function eventIdFrom(url: string): string {
  const match = /\/dashboard\/([0-9a-f-]{36})\/edit/.exec(url)
  if (match === null) throw new Error(`not an editor URL: ${url}`)
  return match[1] as string
}

type EventRow = { id: string; owner_id: string; status: string; template_id: string; tier: string }

async function eventRow(eventId: string): Promise<EventRow> {
  const rows = (await rest(
    `events?id=eq.${eventId}&select=id,owner_id,status,template_id,tier`
  )) as EventRow[]

  const row = rows[0]
  if (row === undefined) throw new Error(`no event ${eventId}`)
  return row
}

async function publishedCountFor(ownerId: string): Promise<number> {
  const rows = await rest(`events?owner_id=eq.${ownerId}&status=eq.published&select=id`)
  return rows.length
}

test.describe('the shop window', () => {
  test('a signed-out visitor sees the whole invitation, and the way to make it theirs', async ({
    page,
  }) => {
    const { templateId } = await seedPreviewTemplate()

    await page.goto(templatePreviewPath(templateId))
    await openEnvelope(page)

    // The invitation itself, with no session and no door in front of it.
    await expect(page.locator('[data-block-id]').first()).toBeVisible()

    const copy = page.getByTestId('template-copy-link')
    await expect(copy).toBeVisible()
    // The same link for everybody, which is the whole decision: entitlement is
    // an account-level fact, not a secret somebody has to be given.
    await expect(copy).toHaveAttribute('href', templateCopyPath(templateId))

    // And looking is still free. The preview creates nothing, which is what
    // lets it be cached and indexed.
    expect(await eventsForTemplate(templateId)).toHaveLength(0)
  })

  test('the copy link asks who you are, and creates nothing until it knows', async ({ page }) => {
    const { templateId } = await seedPreviewTemplate()

    await page.goto(templateCopyPath(templateId))

    await expect(page.getByTestId('copy-ready')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send me a link' })).toBeVisible()

    /*
     * The whole of the assertion. A link scanner in a chat app, a crawler, and
     * anybody who simply has not signed in all reach exactly this, and none of
     * them may leave an invitation behind. The route mints on the GET, so this
     * is the branch that stops it being minted by a preview fetch.
     */
    expect(await eventsForTemplate(templateId)).toHaveLength(0)
  })

  test('a copy link for a template nobody published is a 404, like its preview', async ({
    page,
  }) => {
    const response = await page.goto(templateCopyPath(randomUUID()))

    expect(response?.status()).toBe(404)
  })
})

test.describe('making it yours', () => {
  test('signing in from the copy link lands in your own editor, not a dashboard', async ({
    page,
  }) => {
    const { templateId } = await seedPreviewTemplate()
    const email = freshVisitor()
    const visitorId = await ensureBuyerAccount(email)

    // The mailbox round trip, with the destination inside the link. The account
    // is created here rather than by the auth API because the local stack has no
    // mailer; see tests/support/activation.ts.
    await page.goto(await createSignInLink(email, { next: templateCopyPath(templateId) }))

    // Not /dashboard. Losing somebody at the sign-in step is losing them.
    await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]{36}\/edit\?claimed=1/)
    await expect(page.getByTestId('just-claimed')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save the invitation' })).toBeVisible()

    const row = await eventRow(eventIdFrom(page.url()))

    expect(row.owner_id).toBe(visitorId)
    expect(row.template_id).toBe(templateId)
    // A draft, always. A copy carrying a placeholder date and the template's
    // example names is not something to put in front of a guest, and a draft is
    // what makes unlimited copies free.
    expect(row.status).toBe('draft')
    // `basic`, because it came from no listing at all. `premium` would say
    // somebody bought something.
    expect(row.tier).toBe('basic')

    // The reply form is drawn from rows the copy created, so an empty question
    // set would show up here.
    await expect(page.getByRole('button', { name: 'Save the reply form' })).toBeVisible()
    await expect(page.locator('[data-question]').first()).toBeVisible()
  })

  test('the copy survives sign-in even when the link loses its query', async ({ page }) => {
    /*
     * The other carrier. A mail provider that rewrites links, or an auth
     * redirect allow list that does not admit a query string, both drop
     * `?next=`. The cookie set when the visitor asked for the link is what is
     * left, and it has to be enough: this is the same failure the claim flow is
     * built around, and here it costs the person rather than the purchase.
     */
    const { templateId } = await seedPreviewTemplate()
    const email = freshVisitor()
    await ensureBuyerAccount(email)

    await page.goto(templateCopyPath(templateId))
    await page.getByLabel('Email address').fill(email)
    await page.getByRole('button', { name: 'Send me a link' }).click()

    // Whether the send itself succeeded depends on the mailer, which the local
    // stack does not have. What is asserted is the note the browser now holds.
    await expect(
      page.locator('[data-testid="copy-link-sent"], [data-testid="copy-error"]')
    ).toBeVisible()

    await page.goto(await createSignInLink(email))

    await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]{36}\/edit\?claimed=1/)
    expect(await eventsForTemplate(templateId)).toHaveLength(1)
  })

  test('copies are unlimited, so pressing it twice makes two', async ({ page }) => {
    const { templateId } = await seedPreviewTemplate()
    const email = freshVisitor()
    await ensureBuyerAccount(email)
    await signIn(page, email)

    await page.goto(templateCopyPath(templateId))
    await expect(page).toHaveURL(EDITOR_URL)
    const first = eventIdFrom(page.url())

    await page.goto(templateCopyPath(templateId))
    await expect(page).toHaveURL(EDITOR_URL)
    const second = eventIdFrom(page.url())

    /*
     * The opposite of the claim link on purpose, and the difference is worth
     * asserting rather than assuming. A second tap on a claim link opens the
     * invitation somebody already paid for, because a spent-code error to
     * somebody who has just paid reads as having lost the purchase. There is
     * nothing to spend here, and two people planning two weddings from one
     * design is the product working.
     */
    expect(second).not.toBe(first)
    expect(await eventsForTemplate(templateId)).toHaveLength(2)
  })
})

test.describe('the limit that carries the weight', () => {
  test('one published invitation at a time still holds for a copy made this way', async ({
    page,
    context,
  }) => {
    const { templateId } = await seedPreviewTemplate()
    const email = freshVisitor()
    const visitorId = await ensureBuyerAccount(email)
    await signIn(page, email)

    // Two copies, through the open link, which is the path a guard written for
    // the claim route would never have seen.
    await page.goto(templateCopyPath(templateId))
    const first = eventIdFrom(page.url())
    await page.goto(templateCopyPath(templateId))
    const second = eventIdFrom(page.url())

    /*
     * The second editor is opened BEFORE the first is published, so the page it
     * holds is the one where publishing still looks possible. That is the case
     * a check on render alone would miss, and it is the real one: a phone with
     * two tabs open.
     */
    const stale = await context.newPage()
    await stale.goto(`/dashboard/${second}/edit`)
    await expect(stale.getByRole('button', { name: 'Publish' })).toBeVisible()

    await page.goto(`/dashboard/${first}/edit`)
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    // The press that must be refused, on a page that was rendered when it was
    // still allowed.
    await stale.getByRole('button', { name: 'Publish' }).click()
    await expect(stale.locator('[data-save-status="failed"]').first()).toBeVisible()

    // Named, and with the way through, because the limit is not a wall.
    await expect(stale.locator('[data-save-status="failed"]').first()).toContainText(
      'already published'
    )
    await expect(stale.locator('[data-save-status="failed"]').first()).toContainText(
      'Take that one down'
    )

    // The only assertion that proves the limit rather than the message.
    expect(await publishedCountFor(visitorId)).toBe(1)
    expect((await eventRow(second)).status).toBe('draft')

    /*
     * A fresh render of that editor offers no Publish button at all, because a
     * control that cannot work is a worse answer than a sentence saying why.
     *
     * A `goto` rather than a `reload`, and not for tidiness: the last
     * navigation on this page was the server action's own POST, and reloading
     * would resubmit it. What is being asserted is what somebody opening the
     * page sees, which is a GET.
     */
    await stale.goto(`/dashboard/${second}/edit`)
    await expect(stale.getByTestId('publication-blocked')).toBeVisible()
    await expect(stale.getByRole('button', { name: 'Publish' })).toHaveCount(0)

    // And the way through works: take the first down, and the second goes up.
    await page.goto(`/dashboard/${first}/edit`)
    await page.getByRole('button', { name: 'Take it down' }).click()
    await expect(page.locator('[data-save-status="saved"]').first()).toBeVisible()

    await stale.goto(`/dashboard/${second}/edit`)
    await stale.getByRole('button', { name: 'Publish' }).click()
    await expect(stale.locator('[data-save-status="saved"]').first()).toBeVisible()

    expect(await publishedCountFor(visitorId)).toBe(1)
    expect((await eventRow(second)).status).toBe('published')

    await stale.close()
  })
})
