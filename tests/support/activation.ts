import { randomUUID } from 'node:crypto'

import { issueCode, findTemplate } from '../../scripts/issue-codes'
import {
  ensureOwner,
  resolveSeedConfig,
  seedTemplate,
  type SeedConfig,
} from '../../scripts/seed-event'
import { claimPath } from '../../src/lib/activation/code.ts'

/**
 * Minting the fixtures activation is walked with, through the captain's own
 * script.
 *
 * Not a second implementation. `scripts/issue-codes.ts` is what mints a code for
 * a real order, so a test helper with its own insert would be testing something
 * nobody runs. The first thing that would drift is `code_prefix`, and the
 * symptom would be a support process that cannot find a paid buyer.
 *
 * The issuer and the buyer are two different accounts here, as they are in
 * production: `activation_codes.owner_id` is the seller, `redeemed_by` is the
 * person who bought it. A fixture that used one account for both would pass
 * against code that confused them.
 */

const config: SeedConfig = resolveSeedConfig()

/** The account that owns templates and issues codes. The platform, in v1. */
export const ISSUER_EMAIL = 'activation-issuer@example.test'

export type MintedCode = {
  /** The plaintext, dashed. It exists here and nowhere in the database. */
  readonly code: string
  /** `/claim/AB4CD-...`, built the same way the script builds it. */
  readonly claimPath: string
  readonly codeId: string
  readonly templateId: string
  readonly issuerId: string
}

/**
 * A published template and one unspent code for it.
 *
 * The template key is unique per call, so parallel workers do not merge into one
 * another's row through `on_conflict=owner_id,key`.
 */
export async function mintClaimLink(
  options: { readonly hostingMonths?: number; readonly expiresAt?: string } = {}
): Promise<MintedCode> {
  const issuerId = await ensureOwner(config, ISSUER_EMAIL)
  const template = await seedTemplate(
    { ownerId: issuerId, themeKey: 'deckle-and-deboss', key: `claim-${randomUUID().slice(0, 8)}` },
    config
  )

  const issued = await issueCode(config, {
    template: await findTemplate(config, template.id),
    hostingMonths: options.hostingMonths ?? 12,
    orderReference: null,
    expiresAt: options.expiresAt ?? null,
    // Only used to build the printed link, which this helper does not read.
    siteUrl: 'http://127.0.0.1:3000',
  })

  return {
    code: issued.code,
    claimPath: claimPath(issued.code),
    codeId: issued.id,
    templateId: template.id,
    issuerId,
  }
}

/** A published template with no code, for the public preview. */
export async function seedPreviewTemplate(): Promise<{
  readonly templateId: string
  readonly issuerId: string
}> {
  const issuerId = await ensureOwner(config, ISSUER_EMAIL)
  const template = await seedTemplate(
    {
      ownerId: issuerId,
      themeKey: 'deckle-and-deboss',
      key: `preview-${randomUUID().slice(0, 8)}`,
    },
    config
  )

  return { templateId: template.id, issuerId }
}

/**
 * An account that can receive a magic link, standing in for `should_create_user`.
 *
 * The real claim flow asks the auth API to create the account while sending the
 * link, and the local stack has no mailer, so that request cannot succeed here.
 * Creating the row through the admin API leaves the database in exactly the
 * state a delivered link would have left it in, which is what the rest of the
 * walk is about. What is not covered by the browser suite is therefore one
 * thing and it is worth naming: that the auth API accepted the send. The
 * decision behind it, which value of `should_create_user` a given code state
 * gets, is in `src/app/claim/[code]/actions.ts` and is the part that could be
 * wrong.
 */
export async function ensureBuyerAccount(email: string): Promise<string> {
  return ensureOwner(config, email)
}

/** Reads rows back with the service role, to prove a page created nothing. */
export async function rest(path: string): Promise<unknown[]> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${await response.text()}`)
  }

  return (await response.json()) as unknown[]
}

export type StoredCode = {
  readonly status: string
  readonly redeemed_by: string | null
  readonly redeemed_event_id: string | null
  readonly code_prefix: string
}

export async function readCode(codeId: string): Promise<StoredCode> {
  const rows = (await rest(
    `activation_codes?id=eq.${codeId}&select=status,redeemed_by,redeemed_event_id,code_prefix`
  )) as StoredCode[]

  const row = rows[0]
  if (row === undefined) throw new Error(`no activation code ${codeId}`)
  return row
}

/** Every event created against one template, which a preview must not add to. */
export async function eventsForTemplate(templateId: string): Promise<unknown[]> {
  return rest(`events?template_id=eq.${templateId}&select=id`)
}
