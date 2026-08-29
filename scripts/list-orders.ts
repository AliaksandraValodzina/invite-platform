#!/usr/bin/env node
/**
 * What happened to the order numbers on the list: what the captain runs when a
 * buyer says it did not work.
 *
 * Two modes, because there are two questions and only one of them can be
 * answered from the database alone.
 *
 *   node scripts/list-orders.ts
 *   node scripts/list-orders.ts --status unclaimed --template classic-invitation
 *
 * lists what is on the list, with each number MASKED to its last four
 * characters. That is what `order_numbers.number_suffix` keeps in the clear,
 * and it is all the database has: the numbers themselves are stored as a
 * SHA-256, so that a stolen dump is not a stack of unclaimed purchases.
 *
 *   node scripts/list-orders.ts --check 3812457901,3812457902
 *   node scripts/list-orders.ts --file ./EtsySoldOrders.csv
 *
 * takes numbers the captain already holds, hashes each one and says exactly
 * what it did. This is the reconciliation: the captain's own Etsy export
 * against the list, number by number, claimed or not. It is also the answer to
 * "my order number does not work", which is one buyer and one line.
 *
 * The hashing is the database's, through `rpc/hash_order_number`, for the
 * reason scripts/load-orders.ts gives: a second implementation of the
 * normalisation rule would eventually disagree with the one that decides what a
 * number IS.
 */

import { readFileSync } from 'node:fs'

import { maskedOrderNumber } from '../src/lib/activation/order-number.ts'

import { findTemplate } from './issue-codes.ts'
import { readBatch } from './load-orders.ts'
import { resolveSeedConfig, type SeedConfig } from './seed-event.ts'

type Json = Record<string, unknown> | unknown[]

async function call(
  config: SeedConfig,
  path: string,
  init: { method?: string; body?: Json } = {}
): Promise<unknown> {
  const headers: Record<string, string> = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    Accept: 'application/json',
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${config.url}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed with ${response.status}: ${text.slice(0, 400)}`
    )
  }

  return text === '' ? null : (JSON.parse(text) as unknown)
}

export type OrderRow = {
  readonly id: string
  readonly number_suffix: string
  readonly status: string
  readonly listed_at: string
  readonly redeemed_at: string | null
  readonly redeemed_event_id: string | null
}

const SELECT = 'id,number_suffix,status,listed_at,redeemed_at,redeemed_event_id'

/**
 * `claimed` and `unclaimed` are the captain's words for `redeemed` and `issued`.
 *
 * The column keeps the schema's words, because it is the same
 * `public.activation_code_status` an activation code uses and renaming it would
 * be a migration for a vocabulary. The translation is here, in both directions:
 * what a filter accepts and what a row prints.
 */
const STATUS_WORDS: Record<string, string> = {
  issued: 'unclaimed',
  redeemed: 'claimed',
  revoked: 'revoked',
}

const STATUS_FILTER: Record<string, string | null> = {
  all: null,
  claimed: 'eq.redeemed',
  unclaimed: 'eq.issued',
  revoked: 'eq.revoked',
}

/** The invitation a claimed number opened, so the captain can go and look at it. */
async function slugsFor(config: SeedConfig, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = ids.filter((id) => id !== '')
  if (wanted.length === 0) return new Map()

  const rows = (await call(
    config,
    `/rest/v1/events?id=in.(${wanted.join(',')})&select=id,slug`
  )) as { id: string; slug: string }[]

  return new Map(rows.map((row) => [row.id, row.slug]))
}

function stamp(value: string | null): string {
  return value === null ? '' : value.slice(0, 10)
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

async function printRows(
  config: SeedConfig,
  rows: readonly OrderRow[],
  label: (row: OrderRow) => string
): Promise<void> {
  const slugs = await slugsFor(
    config,
    rows.map((row) => row.redeemed_event_id ?? '')
  )

  console.log(
    `${pad('Order', 26)}${pad('Status', 11)}${pad('Listed', 12)}${pad('Claimed', 12)}Invitation`
  )

  for (const row of rows) {
    const slug = row.redeemed_event_id === null ? '' : (slugs.get(row.redeemed_event_id) ?? '')
    console.log(
      pad(label(row), 26) +
        pad(STATUS_WORDS[row.status] ?? row.status, 11) +
        pad(stamp(row.listed_at), 12) +
        pad(stamp(row.redeemed_at), 12) +
        slug
    )
  }
}

// CLI ------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith('--')) continue
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      parsed[token.slice(2)] = 'true'
      continue
    }
    parsed[token.slice(2)] = next
    index += 1
  }
  return parsed
}

const USAGE = `Usage:
  node scripts/list-orders.ts [--status claimed|unclaimed|revoked|all] [--template <key|id>] [--limit 200]
  node scripts/list-orders.ts --check 3812457901,3812457902
  node scripts/list-orders.ts --file ./EtsySoldOrders.csv

  With no --check or --file, the numbers are shown masked to their last four
  characters, because that is all the database holds: they are stored hashed.

  With --check or --file, the numbers you pass are hashed and looked up, so each
  one is printed in full beside what it did. That is the reconciliation against
  your own Etsy export, and the answer when a buyer says their number failed.`

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config = resolveSeedConfig()

  const typed =
    args.file !== undefined
      ? readBatch(readFileSync(args.file, 'utf8')).numbers
      : args.check !== undefined
        ? readBatch(args.check.split(',').join('\n')).numbers
        : null

  if (typed !== null) {
    console.log(`Checking ${typed.length} order number(s) against the list\n`)

    const found: OrderRow[] = []
    const missing: string[] = []

    for (const number of typed) {
      const hash = (await call(config, '/rest/v1/rpc/hash_order_number', {
        method: 'POST',
        body: { p_number: number },
      })) as string

      const rows = (await call(
        config,
        `/rest/v1/order_numbers?number_hash=eq.${hash}&select=${SELECT}&limit=1`
      )) as OrderRow[]

      const row = rows[0]
      if (row === undefined) missing.push(number)
      else found.push({ ...row, number_suffix: number })
    }

    if (found.length > 0) await printRows(config, found, (row) => row.number_suffix)

    if (missing.length > 0) {
      console.log(`\nNot on the list (${missing.length}):`)
      for (const number of missing) console.log(`  ${number}`)
      console.log(
        '\nA buyer typing one of these is refused. Load it with scripts/load-orders.ts if the ' +
          'order is real.'
      )
    }
    return
  }

  const status = args.status ?? 'all'
  if (!(status in STATUS_FILTER)) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const query = new URLSearchParams({
    select: SELECT,
    order: 'listed_at.desc',
    limit: args.limit ?? '200',
  })
  const filter = STATUS_FILTER[status]
  if (filter !== null && filter !== undefined) query.set('status', filter)

  if (args.template !== undefined) {
    const template = await findTemplate(config, args.template)
    query.set('template_id', `eq.${template.id}`)
  }

  const rows = (await call(config, `/rest/v1/order_numbers?${query.toString()}`)) as OrderRow[]

  if (rows.length === 0) {
    console.log('No order numbers match. Load a batch with scripts/load-orders.ts.')
    return
  }

  console.log(`${rows.length} order number(s), newest first\n`)
  await printRows(config, rows, (row) => maskedOrderNumber(row.number_suffix))
  console.log(
    '\nNumbers are masked because they are stored hashed. Pass --file with your Etsy export to ' +
      'see each one in full beside what it did.'
  )
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
