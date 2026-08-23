import type { Page } from '@playwright/test'

import { resolveSeedConfig, type SeedConfig } from '../../scripts/seed-event'

/**
 * Signing a buyer in, in a browser, without a mailbox.
 *
 * The auth admin API mints the same one-use hash that would have been emailed,
 * and the test then opens the same callback route a real link opens. So what
 * runs is the real verification, the real cookie writing and the real session,
 * with only the mail delivery skipped. A test that set a cookie by hand would
 * prove nothing about the route that has to set it.
 *
 * `generate_link` needs the service role, which is why this lives in the test
 * support rather than anywhere the app can reach.
 */

export async function createSignInLink(
  email: string,
  options: {
    /**
     * Where the link should land, as `?next=`.
     *
     * This is the carrier that has to survive a mailbox for a claim to survive
     * sign-in, and it is put on by hand here for the same reason the token is:
     * what is being skipped is the delivery, not the route. The callback is the
     * real one and it applies the real allow list.
     */
    readonly next?: string
  } = {},
  config: SeedConfig = resolveSeedConfig()
): Promise<string> {
  const response = await fetch(`${config.url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  })

  if (!response.ok) {
    throw new Error(`could not mint a sign-in link for ${email}: ${await response.text()}`)
  }

  const body = (await response.json()) as { hashed_token?: string }
  if (typeof body.hashed_token !== 'string') {
    throw new Error(`the auth API returned no token for ${email}`)
  }

  const next = options.next === undefined ? '' : `&next=${encodeURIComponent(options.next)}`
  return `/auth/callback?token_hash=${body.hashed_token}${next}`
}

/** Opens the link, which lands on the dashboard with the session cookies set. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(await createSignInLink(email))
}
