#!/usr/bin/env node
/**
 * Mints activation codes: what the captain runs to fill an Etsy delivery.
 *
 * This is the point where the product stops being a service. Before it, every
 * order needed the captain to make an event by hand. After it, an order needs a
 * line pasted into a message.
 *
 * Same rules as `scripts/seed-event.ts`, for the same reasons: it writes through
 * PostgREST with the service role and the auth admin API, which is how the
 * product itself reaches the database, and it imports only leaf modules from
 * `src/` by file name so Node can run it by stripping types.
 *
 * ## The plaintext is printed once and never stored
 *
 * `activation_codes.code_hash` holds `sha256(normalised)` and nothing holds the
 * code itself. That is the whole security model of a bearer token: a database
 * dump must not hand somebody a stack of free invitations. So this prints each
 * code once, and if the terminal is closed before the line reaches the Etsy
 * message the code is gone and a new one has to be minted. `--out` writes them
 * to a file for the same reason a paper receipt exists, and that file is a
 * secret: it is a list of unspent purchases.
 *
 * ## The database does the hashing
 *
 * Through `rpc/hash_activation_code`, rather than a second sha256 here. The
 * normalisation rule (strip separators, uppercase) is part of what a code IS,
 * and two implementations of it would disagree about some character nobody
 * thought about. The symptom would be a paid code that is not found, which is
 * the worst bug this file could have. `src/lib/activation/claim.ts` reads the
 * same way for the same reason.
 *
 * Usage, with a local stack up (`supabase start`):
 *
 *   node scripts/issue-codes.ts --template classic-invitation --count 5
 *   node scripts/issue-codes.ts --template classic-invitation --hosting-months 24 \
 *     --order 3782910238 --out ./codes.txt
 *
 * The links it prints are built from NEXT_PUBLIC_SITE_URL. The product has no
 * name yet, so there is no default host anywhere in this repo: set the variable
 * or accept the local fallback and edit the links yourself.
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'

import {
  ACTIVATION_CODE_BYTES,
  activationCodeFromBytes,
  activationCodePrefix,
  claimUrl,
  formatActivationCode,
  templatePreviewUrl,
} from '../src/lib/activation/code.ts'
import { readSiteConfig } from '../src/lib/env.ts'

import { resolveSeedConfig, type SeedConfig } from './seed-event.ts'

/*
 * The links this prints are built from NEXT_PUBLIC_SITE_URL, which lives in
 * .env.local rather than in the shell. Loading it here is the difference
 * between a link the captain can paste and one they have to edit, and a missing
 * file is not an error: `readSiteConfig` falls back and the output says so.
 * playwright.config.ts does the same thing for the same reason.
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

export type TemplateRow = {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly status: string
  readonly ownerId: string
}

/**
 * The template a code names, found by key or by id.
 *
 * By key is what a person types, and `templates_owner_id_key_key` is unique per
 * owner rather than globally, so a key that matches more than one row is an
 * error rather than a guess. A code that named the wrong seller's template
 * would be a buyer receiving a design nobody sold them.
 */
export async function findTemplate(config: SeedConfig, reference: string): Promise<TemplateRow> {
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)
  const filter = byId ? `id=eq.${reference}` : `key=eq.${encodeURIComponent(reference)}`

  const rows = (await call(
    config,
    `/rest/v1/templates?${filter}&select=id,key,name,status,owner_id`
  )) as { id: string; key: string; name: string; status: string; owner_id: string }[]

  if (rows.length === 0) {
    throw new Error(
      `no template matches "${reference}". Seed one first, or pass its id. ` +
        'node scripts/seed-event.ts creates a template alongside an event.'
    )
  }
  if (rows.length > 1) {
    throw new Error(
      `"${reference}" matches ${rows.length} templates, which are owned by different accounts. ` +
        'Pass the id instead: ' +
        rows.map((row) => `${row.id} (${row.name})`).join(', ')
    )
  }

  const row = rows[0] as (typeof rows)[number]
  return { id: row.id, key: row.key, name: row.name, status: row.status, ownerId: row.owner_id }
}

export type IssuedCode = {
  /** The plaintext, dashed. This exists here and in the buyer's message only. */
  readonly code: string
  readonly prefix: string
  readonly id: string
  readonly claimUrl: string
}

/**
 * Mints one code and stores its hash.
 *
 * `owner_id` is the template's owner: the ISSUER, never the redeemer. The
 * column's own comment says so, and it is the seam that lets a seller issue
 * their own codes later without a migration.
 *
 * A hash collision would violate `activation_codes_code_hash_key` and fail the
 * insert. With 100 bits that will not happen, and it is worth saying that the
 * unique index rather than this script is what guarantees it.
 */
export async function issueCode(
  config: SeedConfig,
  input: {
    readonly template: TemplateRow
    readonly hostingMonths: number
    readonly orderReference: string | null
    readonly expiresAt: string | null
    readonly siteUrl: string
  }
): Promise<IssuedCode> {
  const code = activationCodeFromBytes(randomBytes(ACTIVATION_CODE_BYTES))

  const hash = (await call(config, '/rest/v1/rpc/hash_activation_code', {
    method: 'POST',
    body: { p_code: code },
  })) as string

  const rows = (await call(config, '/rest/v1/activation_codes', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      owner_id: input.template.ownerId,
      template_id: input.template.id,
      code_hash: hash,
      code_prefix: activationCodePrefix(code),
      hosting_months: input.hostingMonths,
      order_reference: input.orderReference,
      expires_at: input.expiresAt,
    },
  })) as { id: string }[]

  const row = rows[0]
  if (row === undefined) throw new Error('the activation code was written but not returned')

  return {
    code: formatActivationCode(code),
    prefix: activationCodePrefix(code),
    id: row.id,
    claimUrl: claimUrl(input.siteUrl, code),
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
      throw new Error(`${token} needs a value`)
    }
    parsed[token.slice(2)] = next
    index += 1
  }
  return parsed
}

const USAGE = `Usage:
  node scripts/issue-codes.ts --template <key|id> [--count 1] [--hosting-months 12] \\
    [--order <etsy order id>] [--expires 2027-01-31T00:00:00Z] [--out ./codes.txt]

  --template        the design a code activates, by templates.key or templates.id
  --count           how many codes to mint. Each is one paid activation
  --hosting-months  the term the code grants, 1 to 120. It lives on the code so a
                    promotion can vary it without a schema change
  --order           the Etsy order id, kept for reconciliation and refunds
  --expires         when the code stops being claimable. Absent means never
  --out             append the codes to a file as well as printing them. That
                    file is a list of unspent purchases: treat it as a secret

  The plaintext codes are printed once and are not stored anywhere. Lose them and
  the only fix is minting new ones and revoking these.`

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const templateReference = args.template
  if (templateReference === undefined) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const count = Number(args.count ?? '1')
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    console.error(`--count must be a whole number between 1 and 500, got "${args.count}"`)
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

  const config = resolveSeedConfig()
  const { siteUrl, siteUrlConfigured } = readSiteConfig()
  const template = await findTemplate(config, templateReference)

  if (template.status !== 'published') {
    console.error(
      `template "${template.key}" is ${template.status}, not published. ` +
        'A code for it would activate a design that is not on sale, and its preview link would 404.'
    )
    process.exitCode = 1
    return
  }

  const issued: IssuedCode[] = []
  for (let index = 0; index < count; index += 1) {
    issued.push(
      await issueCode(config, {
        template,
        hostingMonths,
        orderReference: args.order ?? null,
        expiresAt: args.expires ?? null,
        siteUrl,
      })
    )
  }

  if (args.out !== undefined) {
    appendFileSync(args.out, issued.map((one) => `${one.code}\t${one.claimUrl}\n`).join(''))
  }

  console.log(`Template: ${template.name} (${template.key})`)
  console.log(`Preview link, safe to publish anywhere: ${templatePreviewUrl(siteUrl, template.id)}`)
  console.log(`Hosting granted: ${hostingMonths} months`)
  if (!siteUrlConfigured) {
    console.log(
      `\nNEXT_PUBLIC_SITE_URL is not set, so the links below use ${siteUrl}. ` +
        'Set it before sending anything to a buyer.'
    )
  }
  console.log(
    count === 1
      ? '\n1 claim link, good for one invitation:\n'
      : `\n${count} claim links, each good for one invitation:\n`
  )

  for (const one of issued) {
    console.log(one.claimUrl)
    console.log(`  code ${one.code}, support prefix ${one.prefix}`)
  }

  console.log(
    '\nThese are printed once and are not stored. Paste one into the order message for the buyer.'
  )
}

// Only when run directly, so a test can import the functions above.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
