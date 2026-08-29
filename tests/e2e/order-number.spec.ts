import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { ORDER_FORM_PATH, orderPath } from '@/lib/activation/order-number'
import { createSignInLink } from '../support/auth'
import { ensureBuyerAccount, eventsForTemplate, rest } from '../support/activation'
import { freshOrderNumber, listOrderNumber, readOrder } from '../support/orders'

/**
 * The gate the first paid listing is waiting on: a buyer types their Etsy order
 * number and gets their template.
 *
 * The captain's decision, taken twice. Checking a number against Etsy live
 * needs Open API v3 approval which this shop does not have, so the site checks
 * it against a list the captain loads from their own dashboard in batches. The
 * three properties that make that safe are the three this file exists to hold,
 * in the order they would be lost:
 *
 *   1. An unknown number is REFUSED, in a sentence naming what to do next. A
 *      typed number that was trusted would make the whole list pointless.
 *   2. A number is SINGLE USE against one account. Otherwise the first buyer to
 *      post their order number publicly gives the template away to everyone.
 *   3. The buyer is SELF-SERVE. A valid number reaches the editor with nobody
 *      in the middle, which is the entire reason this shape was chosen over the
 *      two the captain rejected.
 *
 * `/claim/<code>` is untouched and tests/e2e/activation.spec.ts still walks it:
 * a code is what the captain sends when something has gone wrong with an order,
 * and this is what everybody else uses.
 *
 * One buyer per test, and a fresh address each time. A magic link is a one-use
 * token stored against the auth user, so two tests sharing a buyer take turns
 * being signed out.
 */

function freshBuyer(): string {
  return `order-buyer-${randomUUID()}@example.test`
}

const EDITOR_URL = /\/dashboard\/[0-9a-f-]{36}\/edit/

function eventIdFrom(url: string): string {
  const match = /\/dashboard\/([0-9a-f-]{36})\/edit/.exec(url)
  if (match === null) throw new Error(`not an editor URL: ${url}`)
  return match[1] as string
}

test.describe('typing an order number', () => {
  test('a buyer with a listed number reaches their own editor, with nobody in the middle', async ({
    page,
  }) => {
    const listed = await listOrderNumber()
    const email = freshBuyer()

    // 1. The one public link, out of the Etsy listing.
    await page.goto(ORDER_FORM_PATH)
    await expect(page.getByTestId('order-intro')).toBeVisible()

    await page.getByLabel('Etsy order number').fill(listed.number)
    await page.getByRole('button', { name: 'Open my invitation' }).click()

    // 2. Recognised, and asking who they are. Nothing is redeemed by looking:
    //    a link scanner or a curious visitor reaches exactly this.
    await expect(page).toHaveURL(new RegExp(`${orderPath(listed.number)}$`))
    await expect(page.getByTestId('order-ready')).toBeVisible()
    expect((await readOrder(listed.number)).status).toBe('issued')
    expect(await eventsForTemplate(listed.templateId)).toHaveLength(0)

    // 3. The mailbox round trip. The account is created here rather than by the
    //    auth API because the local stack has no mailer; see tests/support/activation.ts.
    await ensureBuyerAccount(email)
    await page.goto(await createSignInLink(email, { next: orderPath(listed.number) }))

    // 4. Signed in, in their own editable copy, having typed one number.
    await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]{36}\/edit\?claimed=1/)
    await expect(page.getByTestId('just-claimed')).toBeVisible()

    const eventId = eventIdFrom(page.url())

    // The number is used, and it names the invitation it opened. That pair is
    // what lets the captain answer a buyer who says it did not work.
    const used = await readOrder(listed.number)
    expect(used.status).toBe('redeemed')
    expect(used.redeemed_event_id).toBe(eventId)

    // Theirs, a draft, from the template the order was listed against.
    const rows = (await rest(
      `events?id=eq.${eventId}&select=status,template_id,hosting_expires_at`
    )) as { status: string; template_id: string; hosting_expires_at: string }[]

    expect(rows[0]?.status).toBe('draft')
    expect(rows[0]?.template_id).toBe(listed.templateId)

    const months =
      (new Date(rows[0]?.hosting_expires_at ?? 0).getTime() - Date.now()) / (86_400_000 * 30.4)
    expect(months).toBeGreaterThan(11)
    expect(months).toBeLessThan(13)

    // The reply form is drawn from rows the redemption created, so an empty
    // question set would show up here rather than on the buyer's live page.
    await expect(page.getByRole('button', { name: 'Save the reply form' })).toBeVisible()
    await expect(page.locator('[data-question]').first()).toBeVisible()
  })

  test('the number survives sign-in even when the link loses its query', async ({ page }) => {
    /*
     * The other carrier. A mail provider that rewrites links, or an auth
     * redirect allow list that does not admit a query string, both drop
     * `?next=`. The cookie set when the buyer asked for the link is what is
     * left, and on a paid route it has to be enough: arriving signed in at an
     * empty dashboard reads as having paid and received nothing.
     */
    const listed = await listOrderNumber()
    const email = freshBuyer()
    await ensureBuyerAccount(email)

    await page.goto(listed.orderPath)
    await page.getByLabel('Email address').fill(email)
    await page.getByRole('button', { name: 'Send me a link' }).click()

    // Whether the send itself succeeded depends on the mailer, which the local
    // stack does not have. What is asserted is the note the browser now holds.
    await expect(
      page.locator('[data-testid="order-link-sent"], [data-testid="order-sign-in-error"]')
    ).toBeVisible()

    await page.goto(await createSignInLink(email))

    await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]{36}\/edit\?claimed=1/)
    expect((await readOrder(listed.number)).status).toBe('redeemed')
  })
})

test.describe('a number is single use', () => {
  test('a second attempt by the same buyer opens the invitation they already have', async ({
    page,
  }) => {
    /*
     * A double tap on a phone is two requests, and neither may show somebody a
     * used-number refusal about the thing they just bought. Same account, same
     * invitation, and no second event.
     */
    const listed = await listOrderNumber()
    const email = freshBuyer()
    await ensureBuyerAccount(email)

    await page.goto(await createSignInLink(email, { next: listed.orderPath }))
    await expect(page).toHaveURL(EDITOR_URL)
    const first = eventIdFrom(page.url())

    await page.goto(listed.orderPath)
    await expect(page).toHaveURL(EDITOR_URL)
    expect(eventIdFrom(page.url())).toBe(first)

    expect(await eventsForTemplate(listed.templateId)).toHaveLength(1)
  })

  test('a second attempt by anybody else is refused, in a sentence', async ({ page }) => {
    /*
     * The assertion this whole design rests on. An order number travels: it is
     * on a receipt, in an email, and in a screenshot somebody posts to a
     * Facebook group. The first buyer to publish theirs must not be handing the
     * template out, so a second account typing it gets a refusal that names
     * what to do rather than a second invitation.
     */
    const listed = await listOrderNumber()

    const buyer = freshBuyer()
    await ensureBuyerAccount(buyer)
    await page.goto(await createSignInLink(buyer, { next: listed.orderPath }))
    await expect(page).toHaveURL(EDITOR_URL)

    const stranger = freshBuyer()
    await ensureBuyerAccount(stranger)
    await page.goto(await createSignInLink(stranger))
    await page.goto(listed.orderPath)

    await expect(
      page.getByRole('heading', { name: 'That order number has already been used' })
    ).toBeVisible()

    const refusal = page.getByTestId('order-other-account')
    await expect(refusal).toBeVisible()
    await expect(refusal).toContainText('an order number only opens one')
    // The sentence has to name the way out. A refusal that only says no leaves
    // somebody who signed in with the wrong address with nowhere to go.
    await expect(refusal).toContainText('Sign out and sign back in')

    // Nothing was created for them, and the number still names the first
    // buyer's invitation.
    expect(await eventsForTemplate(listed.templateId)).toHaveLength(1)
    expect((await readOrder(listed.number)).status).toBe('redeemed')
  })

  test('a signed-out visitor who types a used number is asked to sign in, not given a copy', async ({
    page,
  }) => {
    const listed = await listOrderNumber()
    const buyer = freshBuyer()
    await ensureBuyerAccount(buyer)
    await page.goto(await createSignInLink(buyer, { next: listed.orderPath }))
    await expect(page).toHaveURL(EDITOR_URL)

    await page.context().clearCookies()
    await page.goto(listed.orderPath)

    await expect(page.getByTestId('order-already')).toBeVisible()
    expect(await eventsForTemplate(listed.templateId)).toHaveLength(1)
  })
})

test.describe('a number that is not on the list', () => {
  test('is refused at the form, in a sentence naming what to do next', async ({ page }) => {
    const unlisted = freshOrderNumber()

    await page.goto(ORDER_FORM_PATH)
    await page.getByLabel('Etsy order number').fill(unlisted)
    await page.getByRole('button', { name: 'Open my invitation' }).click()

    const refusal = page.getByTestId('order-error')
    await expect(refusal).toBeVisible()
    await expect(refusal).toContainText('cannot find that order number')
    // The sentence has to name the way out, or a buyer whose order is genuinely
    // too recent has nowhere to go.
    await expect(refusal).toContainText('reply to your Etsy order message')

    // And the buyer is still on the form with what they typed, because the
    // commonest reason to be here is one wrong digit.
    await expect(page).toHaveURL(new RegExp(`${ORDER_FORM_PATH}$`))
    await expect(page.getByLabel('Etsy order number')).toHaveValue(unlisted)
  })

  test('is refused at the URL too, so the form is not the only check', async ({ page }) => {
    await page.goto(orderPath(freshOrderNumber()))

    await expect(page.getByTestId('order-unknown')).toBeVisible()
  })

  test('is refused before it reaches the database when it is not shaped like one', async ({
    page,
  }) => {
    await page.goto(ORDER_FORM_PATH)
    await page.getByLabel('Etsy order number').fill('123')
    await page.getByRole('button', { name: 'Open my invitation' }).click()

    await expect(page.getByTestId('order-error')).toContainText(
      'does not look like an order number'
    )
  })
})

test.describe('what the buyer is told about their order', () => {
  test('the page quotes four characters for support and never the whole number', async ({
    page,
  }) => {
    const listed = await listOrderNumber()

    await page.goto(listed.orderPath)

    const quoted = page.getByTestId('order-suffix')
    await expect(quoted).toHaveText(`••••${listed.number.slice(-4)}`)
    // The whole number is in the URL because the buyer typed it. It is not
    // repeated into the page, where it would be read out over a shoulder or
    // pasted into a message going somewhere else.
    await expect(quoted).not.toHaveText(listed.number)
  })
})
