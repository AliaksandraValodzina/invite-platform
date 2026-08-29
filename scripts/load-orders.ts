#!/usr/bin/env node
/**
 * Loads a batch of Etsy order numbers: what the captain runs once a week.
 *
 * This is the whole of the manual half of order verification. Etsy shows the
 * captain every order in their own dashboard; this puts those numbers on the
 * list the site checks a typed number against. The buyer stays self-serve, an
 * unknown number is refused, and no Etsy API approval is involved.
 *
 * It upgrades cleanly and nothing here is built for that: the day Open API v3
 * is approved, something else writes the same rows and this script stops being
 * run. See docs/orders.md.
 *
 * Same rules as `scripts/issue-codes.ts`, for the same reasons: it writes
 * through PostgREST with the service role, which is how the product itself
 * reaches the database, and it imports only leaf modules from `src/` by file
 * name so Node can run it by stripping types.
 *
 * ## The database does the hashing
 *
 * Through `rpc/hash_order_number`, one round trip per number, rather than a
 * second sha256 here. The normalisation rule is part of what a number IS, and
 * two implementations of it would disagree about some character nobody thought
 * about. The symptom would be a paid buyer told their order does not exist,
 * which is the worst bug this file could have. A batch of two hundred costs two
 * hundred small requests and a few seconds, once a week.
 *
 * ## What it reads
 *
 * Either a file or a comma separated list. The file may be Etsy's own order
 * export or a plain list of numbers, one per line. Blank lines are ignored, and
 * so are comments: a `#` followed by anything but a digit, so that a receipt
 * pasted as `#3812457901` is still an order number:
 *
 *   node scripts/load-orders.ts --template classic-invitation --file ./EtsySoldOrders.csv
 *   node scripts/load-orders.ts --template classic-invitation --numbers 3812457901,3812457902
 *   node scripts/load-orders.ts --template classic-invitation --file ./orders.txt --dry-run
 *
 * Loading the same batch twice is safe and is expected to happen: the unique
 * index on `order_numbers.number_hash` means a number already on the list is
 * skipped rather than duplicated, so the captain can always re-load the whole
 * export rather than remembering where they got to.
 */

import { readFileSync } from 'node:fs'

import {
  isPossibleOrderNumber,
  normaliseOrderNumber,
  orderFormUrl,
  orderNumberSuffix,
} from '../src/lib/activation/order-number.ts'
import { readSiteConfig } from '../src/lib/env.ts'

import { findTemplate, type TemplateRow } from './issue-codes.ts'
import { resolveSeedConfig, type SeedConfig } from './seed-event.ts'

/*
 * NEXT_PUBLIC_SITE_URL lives in .env.local rather than in the shell, and the
 * link this prints is the one that goes in the Etsy listing. A missing file is
 * not an error: `readSiteConfig` falls back and the output says so.
 */
try {
  process.loadEnvFile('.env.local')
} catch {
  /* no local file, which is the normal case in CI */
}

type Json = Record<string, unknown> | unknown[]

async function call(
  config: SeedConfig,
  path: string,
  init: { method?: string; body?: Json; prefer?: string } = {}
): Promise<unknown> {
  const headers: Record<string, string> = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    Accept: 'application/json',
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.prefer !== undefined) headers.Prefer = init.prefer

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

// Reading a batch ------------------------------------------------------------

/** One line of a CSV, split on commas outside double quotes. */
export function csvFields(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false

  for (let at = 0; at < line.length; at += 1) {
    const character = line[at]
    if (quoted) {
      if (character === '"') {
        if (line[at + 1] === '"') {
          field += '"'
          at += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }
    if (character === '"') {
      quoted = true
    } else if (character === ',' || character === '\t') {
      fields.push(field)
      field = ''
    } else {
      field += character
    }
  }

  fields.push(field)
  return fields.map((one) => one.trim())
}

/** The header names Etsy has used for the column this needs. */
const ORDER_COLUMNS = ['order id', 'order number', 'receipt id', 'order']

export type ReadBatch = {
  /** Normalised, deduplicated, in the order they were read. */
  readonly numbers: string[]
  /** Lines that held no order number, so a wrong column is visible. */
  readonly skipped: string[]
  /** Set when the whole file was refused, and why, for the CLI to print. */
  readonly refused?: string
}

/**
 * The order numbers in a file or a list.
 *
 * Etsy's own export is a CSV with an `Order ID` column, and a captain who has
 * pasted a column out of a spreadsheet has a file of bare numbers. Both work,
 * and neither needs an argument saying which.
 *
 * A table whose order column cannot be named is REFUSED whole rather than read
 * from the left, and that is the important decision here. The shape gate is
 * deliberately tolerant, so a date column reads as a run of digits and a header
 * reads as a word: guessing at a column would quietly put `08292026` on the
 * list as a purchase nobody made. A file this cannot understand is a sentence
 * to the captain, not a batch.
 *
 * Within a file it recognises, anything not shaped like an order number is
 * skipped and reported, so a partly empty export is visible too.
 */
export function readBatch(text: string): ReadBatch {
  /*
   * `#` starts a comment, EXCEPT when a digit follows it. Both readings are
   * real: a captain annotates a working file with `# august`, and a receipt is
   * pasted as `#3812457901`. Dropping the second silently would lose a paid
   * order out of a batch, which is the one failure in this file nobody would
   * see until a buyer complained.
   */
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^#\D/.test(line) && line !== '#')

  let column = 0
  let body = lines

  const header = lines[0]
  if (header !== undefined) {
    const fields = csvFields(header)
    const named = fields.findIndex((field) => ORDER_COLUMNS.includes(field.toLowerCase()))

    if (named >= 0) {
      column = named
      body = lines.slice(1)
    } else if (fields.length > 1) {
      return {
        numbers: [],
        skipped: lines.map((line) => line.slice(0, 80)),
        refused:
          'this file has columns and none of them is named ' +
          ORDER_COLUMNS.map((name) => `"${name}"`).join(', ') +
          '. Export it from Etsy with its own headings, or paste just the order ' +
          'number column into a file of one number per line.',
      }
    }
  }

  const numbers: string[] = []
  const skipped: string[] = []
  const seen = new Set<string>()

  for (const line of body) {
    const field = csvFields(line)[column] ?? ''
    const normalised = normaliseOrderNumber(field)

    if (!isPossibleOrderNumber(normalised)) {
      skipped.push(line.slice(0, 80))
      continue
    }
    if (seen.has(normalised)) continue

    seen.add(normalised)
    numbers.push(normalised)
  }

  return { numbers, skipped }
}

// Writing the batch ----------------------------------------------------------

export type LoadResult = {
  readonly added: number
  readonly alreadyListed: number
}

/**
 * Puts a batch on the list, skipping numbers that are already there.
 *
 * `Prefer: resolution=ignore-duplicates` with `on_conflict=number_hash` turns
 * the unique index into the deduplication rather than a failed batch, and
 * `return=representation` then comes back with only the rows that were actually
 * inserted, because `ON CONFLICT DO NOTHING` returns nothing for the ones it
 * skipped. That is what makes the count printed at the end true rather than
 * hopeful.
 *
 * `owner_id` is the template's owner: the SELLER, never the buyer who redeems
 * it. Same seam as `activation_codes.owner_id`, and the reason is the same one:
 * it is what lets a seller keep their own list later without a migration.
 */
export async function loadOrders(
  config: SeedConfig,
  input: {
    readonly template: TemplateRow
    readonly numbers: readonly string[]
    readonly hostingMonths: number
    readonly expiresAt: string | null
  }
): Promise<LoadResult> {
  const rows: Record<string, unknown>[] = []

  for (const number of input.numbers) {
    const hash = (await call(config, '/rest/v1/rpc/hash_order_number', {
      method: 'POST',
      body: { p_number: number },
    })) as string

    rows.push({
      owner_id: input.template.ownerId,
      template_id: input.template.id,
      number_hash: hash,
      number_suffix: orderNumberSuffix(number),
      hosting_months: input.hostingMonths,
      expires_at: input.expiresAt,
    })
  }

  if (rows.length === 0) return { added: 0, alreadyListed: 0 }

  const inserted = (await call(config, '/rest/v1/order_numbers?on_conflict=number_hash', {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=representation',
    body: rows,
  })) as unknown[]

  const added = Array.isArray(inserted) ? inserted.length : 0
  return { added, alreadyListed: rows.length - added }
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
  node scripts/load-orders.ts --template <key|id> (--file <path> | --numbers 123,456) \\
    [--hosting-months 12] [--expires 2027-01-31T00:00:00Z] [--dry-run]

  --template        the design these orders bought, by templates.key or templates.id
  --file            a file of order numbers. Etsy's own export works: if the first
                    line names an "Order ID" column that column is used, otherwise
                    the first field of every line is. Blank lines and lines starting
                    with # are ignored
  --numbers         a comma separated list, for one or two orders
  --hosting-months  the term each order grants, 1 to 120
  --expires         when an unclaimed number stops working. Absent means never
  --dry-run         read and report, write nothing

  Re-loading a batch is safe: a number already on the list is skipped rather than
  duplicated, so the whole export can be loaded every time.

  Use scripts/list-orders.ts to see which numbers have been claimed.`

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const templateReference = args.template
  if (templateReference === undefined || (args.file === undefined && args.numbers === undefined)) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const hostingMonths = Number(args['hosting-months'] ?? '12')
  if (!Number.isInteger(hostingMonths) || hostingMonths < 1 || hostingMonths > 120) {
    console.error(
      `--hosting-months must be a whole number between 1 and 120, got "${args['hosting-months']}"`
    )
    process.exitCode = 1
    return
  }

  const text =
    args.file !== undefined
      ? readFileSync(args.file, 'utf8')
      : (args.numbers ?? '').split(',').join('\n')

  const batch = readBatch(text)

  const config = resolveSeedConfig()
  const { siteUrl, siteUrlConfigured } = readSiteConfig()
  const template = await findTemplate(config, templateReference)

  if (template.status !== 'published') {
    console.error(
      `template "${template.key}" is ${template.status}, not published. ` +
        'A buyer who typed one of these numbers would be handed a design that is not on sale.'
    )
    process.exitCode = 1
    return
  }

  console.log(`Template: ${template.name} (${template.key})`)
  console.log(`Read ${batch.numbers.length} order number(s)`)

  if (batch.refused !== undefined) {
    console.error(`\nNothing was read: ${batch.refused}`)
    process.exitCode = 1
    return
  }

  if (batch.skipped.length > 0) {
    console.log(`\nSkipped ${batch.skipped.length} line(s) that held no order number:`)
    for (const line of batch.skipped.slice(0, 5)) console.log(`  ${line}`)
    if (batch.skipped.length > 5) console.log(`  ... and ${batch.skipped.length - 5} more`)
  }

  if (args['dry-run'] === 'true') {
    console.log('\n--dry-run, so nothing was written.')
    return
  }

  const result = await loadOrders(config, {
    template,
    numbers: batch.numbers,
    hostingMonths,
    expiresAt: args.expires ?? null,
  })

  console.log(`\nAdded ${result.added}, already on the list ${result.alreadyListed}.`)
  console.log(`Hosting granted per order: ${hostingMonths} months`)

  if (!siteUrlConfigured) {
    console.log(
      `\nNEXT_PUBLIC_SITE_URL is not set, so the link below uses ${siteUrl}. ` +
        'Set it before putting it in a listing.'
    )
  }

  console.log(`\nThe link that goes in the listing and the order message:\n`)
  console.log(orderFormUrl(siteUrl))
  console.log(
    '\nThe buyer types their Etsy order number there. It opens their invitation once, and a ' +
      'number that is not on this list is refused.'
  )
}

// Only when run directly, so a test can import the functions above.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
