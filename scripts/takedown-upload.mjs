#!/usr/bin/env node
//
// Takes one uploaded asset down, and removes its bytes.
//
// This is the mechanism behind the paragraph in /terms. Content responsibility
// sits with the buyer, and that only means anything if there is a way to act on
// a complaint. Buyers will upload copyrighted music, somebody will write to the
// address on that page, and the answer has to be per asset: a complaint about
// one song must not take down a wedding page.
//
// What it does, in order:
//
//   1. `public.disable_upload` marks the row disabled with a reason and queues
//      every object key it held. The event, its other assets and its replies
//      are untouched.
//   2. POST /api/uploads/sweep removes the bytes from the object store. That
//      step is separate because the database cannot make an HTTP request, and
//      it is here because a takedown that leaves the bytes served is not one.
//
// The honest limit, worth knowing before promising a rights holder a response
// time: an asset address carries a one year immutable cache lifetime, so a
// browser or a CDN edge that already holds a copy keeps serving it until that
// expires. Removing the object stops new fetches. Nothing stops old ones.
//
// Usage:
//   node scripts/takedown-upload.mjs <upload-id> "<reason>" [--site http://localhost:3000]
//
// Credentials come from the environment or from `supabase status`, the same way
// scripts/check-anon-access.mjs resolves them.

import { execFileSync } from 'node:child_process'

const [uploadId, reason, ...rest] = process.argv.slice(2)

if (!uploadId || !reason) {
  console.error('usage: node scripts/takedown-upload.mjs <upload-id> "<reason>" [--site <url>]')
  process.exit(2)
}

const siteFlag = rest.indexOf('--site')
const site = (
  siteFlag === -1
    ? (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000')
    : rest[siteFlag + 1]
).replace(/\/$/, '')

function resolveConfig() {
  let { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    let status
    try {
      status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }))
    } catch {
      throw new Error(
        'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or run this with a local stack up.'
      )
    }
    SUPABASE_URL ||= status.API_URL
    SUPABASE_SERVICE_ROLE_KEY ||= status.SERVICE_ROLE_KEY
  }

  return { url: SUPABASE_URL.replace(/\/$/, ''), serviceKey: SUPABASE_SERVICE_ROLE_KEY }
}

const config = resolveConfig()

const disabled = await fetch(`${config.url}/rest/v1/rpc/disable_upload`, {
  method: 'POST',
  headers: {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_upload_id: uploadId, p_reason: reason }),
})

if (!disabled.ok) {
  console.error(`disable_upload failed with ${disabled.status}: ${await disabled.text()}`)
  process.exit(1)
}

const alreadyGone = (await disabled.json()) !== true
if (alreadyGone) {
  console.log(`${uploadId} was already disabled, or does not exist. Sweeping anyway.`)
} else {
  console.log(`${uploadId} disabled: ${reason}`)
}

const sweepSecret = process.env.UPLOADS_SWEEP_SECRET ?? ''
const swept = await fetch(`${site}/api/uploads/sweep`, {
  method: 'POST',
  headers: sweepSecret === '' ? {} : { Authorization: `Bearer ${sweepSecret}` },
})

if (!swept.ok) {
  console.error(
    `the row is disabled but the bytes are still stored: the sweep answered ${swept.status}. ` +
      `Run it again against a live deployment: POST ${site}/api/uploads/sweep`
  )
  process.exit(1)
}

const report = await swept.json()
console.log(
  `swept ${report.driver}: claimed ${report.claimed}, deleted ${report.deleted}, ` +
    `already absent ${report.missing}, failed ${report.failed?.length ?? 0}`
)
