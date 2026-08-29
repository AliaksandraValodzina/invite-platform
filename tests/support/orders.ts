import { randomInt, randomUUID } from 'node:crypto'

import { findTemplate } from '../../scripts/issue-codes'
import { loadOrders } from '../../scripts/load-orders'
import {
  ensureOwner,
  resolveSeedConfig,
  seedTemplate,
  type SeedConfig,
} from '../../scripts/seed-event'
import { orderPath } from '../../src/lib/activation/order-number.ts'

/**
 * Putting an order number on the list, through the captain's own script.
 *
 * Not a second implementation. `scripts/load-orders.ts` is what loads a real
 * batch, so a test helper with its own insert would be testing something nobody
 * runs. The first thing that would drift is `number_suffix`, and the symptom
 * would be a support process that cannot find a paid buyer.
 *
 * The seller and the buyer are two different accounts here, as they are in
 * production: `order_numbers.owner_id` is the seller and `redeemed_by` is the
 * person who bought it. A fixture that used one account for both would pass
 * against code that confused them.
 */

const config: SeedConfig = resolveSeedConfig()

/** The account that owns templates and lists orders. The platform, in v1. */
export const SELLER_EMAIL = 'order-seller@example.test'

async function service(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const headers: Record<string, string> = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    Accept: 'application/json',
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed with ${response.status}`)
  }

  return response.json()
}

export type ListedOrder = {
  /** The plaintext, which exists here and nowhere in the database. */
  readonly number: string
  /** `/order/3812457901`, built the way the app builds it. */
  readonly orderPath: string
  readonly templateId: string
  readonly sellerId: string
}

/** Ten digits, like Etsy's, and not shared with any other test in this run. */
export function freshOrderNumber(): string {
  return String(randomInt(1_000_000_000, 9_999_999_999))
}

/**
 * A published template and one unclaimed order number for it.
 *
 * The template key is unique per call, so parallel workers do not merge into
 * one another's row through `on_conflict=owner_id,key`.
 */
export async function listOrderNumber(
  options: { readonly hostingMonths?: number; readonly expiresAt?: string } = {}
): Promise<ListedOrder> {
  const sellerId = await ensureOwner(config, SELLER_EMAIL)
  const template = await seedTemplate(
    { ownerId: sellerId, themeKey: 'deckle-and-deboss', key: `order-${randomUUID().slice(0, 8)}` },
    config
  )

  const number = freshOrderNumber()

  const result = await loadOrders(config, {
    template: await findTemplate(config, template.id),
    numbers: [number],
    hostingMonths: options.hostingMonths ?? 12,
    expiresAt: options.expiresAt ?? null,
  })

  if (result.added !== 1) {
    throw new Error(`the order number was not listed: added ${result.added}`)
  }

  return { number, orderPath: orderPath(number), templateId: template.id, sellerId }
}

export type StoredOrder = {
  readonly status: string
  readonly redeemed_by: string | null
  readonly redeemed_event_id: string | null
  readonly number_suffix: string
}

/**
 * Reads the row back with the service role, to prove what a page did.
 *
 * By hash, through the database's own function, because that is the only way
 * in: the number itself is not stored. It is also the same round trip the app
 * makes, so a fixture that could find a row the app could not would be a
 * fixture lying about the schema.
 */
export async function readOrder(number: string): Promise<StoredOrder> {
  const hash = (await service('rpc/hash_order_number', {
    method: 'POST',
    body: { p_number: number },
  })) as string

  const rows = (await service(
    `order_numbers?number_hash=eq.${hash}&select=status,redeemed_by,redeemed_event_id,number_suffix&limit=1`
  )) as StoredOrder[]

  const row = rows[0]
  if (row === undefined) throw new Error(`no order number ending ${number.slice(-4)}`)
  return row
}

/** Whether a number is on the list at all, for the refusal path. */
export async function isListed(number: string): Promise<boolean> {
  try {
    await readOrder(number)
    return true
  } catch {
    return false
  }
}
