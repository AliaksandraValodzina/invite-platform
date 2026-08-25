#!/usr/bin/env node
/**
 * Asks a live origin what commit it is serving, and fails when it is not the
 * one it should be.
 *
 * This is the check that was missing on 2026-08-24. A merge to `main` produced
 * no Vercel deployment at all, silently: GitHub opened a check suite for the
 * Vercel app two seconds after the push and Vercel never came back to it, so
 * there was no deployment record, no failed status and nothing red anywhere.
 * The site served the previous commit for a day.
 *
 * The property this restores is that publishing is only finished when the
 * public address says so. It reads `<origin>/api/version` over plain HTTP with
 * no credential, which is the same wire a guest uses, so it catches every way
 * the last step can go wrong and not just the one that happened: a deploy that
 * was never made, a deploy that was made and never aliased, a rollback, and a
 * build whose commit is not the one CI thought it was building.
 *
 * It fails closed. "Cannot tell" is never a pass.
 *
 * Usage: node .github/scripts/deployed-commit.mjs <origin> <expected-sha>
 *
 * Its logic is tested in deployed-commit.test.mjs, run by the `static` job.
 */

import { pathToFileURL } from 'node:url'

/** Poll for a while: a production alias does not always move the instant a deployment is ready. */
export const DEFAULT_ATTEMPTS = 10
export const DEFAULT_WAIT_MS = 6000

const FULL_SHA = /^[0-9a-f]{40}$/

/**
 * Reads one response into a verdict about that response alone.
 *
 * Every branch that is not "this is the expected commit" returns ok: false,
 * including the ones that are really "the site did not answer properly". A
 * checker that treated an unreadable answer as a pass would be worse than no
 * checker, because it would be a green tick over an unknown.
 */
export function readAnswer(expected, { status, body }) {
  if (status !== 200) {
    return { ok: false, retry: true, message: `/api/version answered ${status}` }
  }

  if (body === null || typeof body !== 'object') {
    return { ok: false, retry: false, message: '/api/version did not answer with a JSON object' }
  }

  const { commit, source } = body

  if (commit === null || commit === undefined) {
    return {
      ok: false,
      retry: false,
      message:
        'the deployment cannot say which commit it was built from (commit: null). ' +
        'A build made outside .github/workflows/ci.yml, and without Vercel git metadata, reports this.',
    }
  }

  if (typeof commit !== 'string' || !FULL_SHA.test(commit)) {
    return {
      ok: false,
      retry: false,
      message: `/api/version reported a commit that is not a sha: ${JSON.stringify(commit)}`,
    }
  }

  if (commit !== expected) {
    return {
      ok: false,
      retry: true,
      message: `serving ${commit} (source: ${source}), expected ${expected}`,
    }
  }

  return { ok: true, retry: false, message: `serving ${commit} (source: ${source})` }
}

/** Fetches once and never throws: a connection error is just another answer that is not the expected commit. */
export async function askOnce(origin, expected, fetchImpl) {
  const url = new URL('/api/version', origin).toString()
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    let body = null
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    return readAnswer(expected, { status: response.status, body })
  } catch (error) {
    return { ok: false, retry: true, message: `could not reach ${url}: ${error.message}` }
  }
}

/**
 * Polls until the origin serves `expected` or the attempts run out.
 *
 * `retry: false` answers stop early. A deployment that reported a commit it
 * cannot have does not become correct by being asked again, and waiting a
 * minute to say so only delays the red.
 */
export async function askUntil(
  origin,
  expected,
  {
    attempts = DEFAULT_ATTEMPTS,
    waitMs = DEFAULT_WAIT_MS,
    fetchImpl = fetch,
    sleep = defaultSleep,
    log = () => {},
  } = {}
) {
  let last = { ok: false, retry: true, message: 'never asked' }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await askOnce(origin, expected, fetchImpl)
    log(`attempt ${attempt}/${attempts}: ${last.ok ? 'ok, ' : ''}${last.message}`)
    if (last.ok || !last.retry) return { ...last, attempts: attempt }
    if (attempt < attempts) await sleep(waitMs)
  }

  return { ...last, attempts }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function usage() {
  return 'usage: node .github/scripts/deployed-commit.mjs <origin> <expected-sha>'
}

export async function main(
  argv,
  {
    fetchImpl = fetch,
    log = console.log,
    error = console.error,
    attempts = DEFAULT_ATTEMPTS,
    waitMs = DEFAULT_WAIT_MS,
    sleep = undefined,
  } = {}
) {
  const [origin, expected] = argv

  if (!origin || !expected) {
    error(usage())
    return 2
  }

  if (!FULL_SHA.test(expected)) {
    error(`expected a full 40 character commit sha, got ${JSON.stringify(expected)}`)
    return 2
  }

  log(`Asking ${origin} what it is serving. Expecting ${expected}.`)
  log(
    `Up to ${attempts} attempts, ${waitMs}ms apart, because a production alias does not always move instantly.`
  )
  const verdict = await askUntil(origin, expected, {
    fetchImpl,
    log,
    attempts,
    waitMs,
    ...(sleep === undefined ? {} : { sleep }),
  })

  if (verdict.ok) {
    log(`${origin} is serving ${expected}.`)
    return 0
  }

  error('')
  error(`${origin} is NOT serving ${expected}.`)
  error(`  ${verdict.message}`)
  error('')
  error('The merge is on main and the live address does not have it. Publishing did not finish.')
  error('docs/hosting.md, "Publishing is done by CI", says what to check and in what order.')
  return 1
}

// Only when run, not when imported by the test file. pathToFileURL rather than
// string concatenation, because a checkout path with a space in it would not
// match and this would quietly become a module that does nothing.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)))
}
