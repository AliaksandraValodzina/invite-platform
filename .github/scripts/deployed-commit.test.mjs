/**
 * Tests for the check that the live address is serving what was merged.
 *
 * Run by the `static` job: `node --test .github/scripts/deployed-commit.test.mjs`.
 * No dependencies, so it does not care whether `npm ci` has run.
 *
 * The first test is the regression test for the incident this whole thing
 * exists for. On 2026-08-24 `main` moved to 6ea846d and mirthly.app went on
 * serving 79df4d5 for a day with nothing red anywhere. Those two shas are the
 * real ones, and this asserts the check goes red on exactly that state of the
 * world rather than asserting some element is absent.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { askUntil, main, readAnswer } from './deployed-commit.mjs'

const MERGED = '6ea846dec2befa0d0207e2b6a0cd1495562622c9' // PR #17, the merge that never deployed
const SERVED = '79df4d54af12f6ef4ccc7471e2fc3497331998dd' // PR #16, what the site kept serving

/** A server that answers /api/version with whatever the queue hands it, so a sequence can be tested. */
async function serving(answers) {
  const queue = [...answers]
  const server = http.createServer((request, response) => {
    if (request.url !== '/api/version') {
      response.writeHead(404).end()
      return
    }
    const next = queue.length > 1 ? queue.shift() : queue[0]
    response.writeHead(next.status, { 'content-type': 'application/json' })
    response.end(typeof next.body === 'string' ? next.body : JSON.stringify(next.body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    close: () =>
      new Promise((resolve) => {
        // fetch keeps the socket alive, and server.close() waits for it. Without
        // this each test pays the keep-alive timeout and the suite takes a minute.
        server.closeAllConnections()
        server.close(resolve)
      }),
  }
}

const noWait = { attempts: 3, waitMs: 0, sleep: async () => {} }

test('the incident: main moved and the site is still serving the commit before it', async () => {
  const site = await serving([{ status: 200, body: { commit: SERVED, source: 'ci' } }])
  try {
    const verdict = await askUntil(site.origin, MERGED, noWait)
    assert.equal(verdict.ok, false)
    assert.match(verdict.message, new RegExp(SERVED))
    assert.match(verdict.message, new RegExp(MERGED))
  } finally {
    await site.close()
  }
})

test('the same state of the world exits non zero through main()', async () => {
  const site = await serving([{ status: 200, body: { commit: SERVED, source: 'ci' } }])
  const said = []
  try {
    const code = await main([site.origin, MERGED], {
      ...noWait,
      log: (line) => said.push(line),
      error: (line) => said.push(line),
    })
    assert.equal(code, 1)
    assert.ok(said.some((line) => line.includes('NOT serving')))
  } finally {
    await site.close()
  }
})

test('the live address serving the merged commit passes', async () => {
  const site = await serving([{ status: 200, body: { commit: MERGED, source: 'ci' } }])
  try {
    const verdict = await askUntil(site.origin, MERGED, noWait)
    assert.equal(verdict.ok, true)
    assert.equal(verdict.attempts, 1)
  } finally {
    await site.close()
  }
})

test('an alias that takes a moment to move is tolerated, not failed', async () => {
  const site = await serving([
    { status: 200, body: { commit: SERVED, source: 'ci' } },
    { status: 200, body: { commit: SERVED, source: 'ci' } },
    { status: 200, body: { commit: MERGED, source: 'ci' } },
  ])
  try {
    const verdict = await askUntil(site.origin, MERGED, noWait)
    assert.equal(verdict.ok, true)
    assert.equal(verdict.attempts, 3)
  } finally {
    await site.close()
  }
})

test('a deployment that cannot say which commit it is fails, and fails immediately', async () => {
  const site = await serving([{ status: 200, body: { commit: null, source: 'unknown' } }])
  try {
    const verdict = await askUntil(site.origin, MERGED, noWait)
    assert.equal(verdict.ok, false)
    // Asking again cannot change the answer, so it must not spend a minute finding that out.
    assert.equal(verdict.attempts, 1)
    assert.match(verdict.message, /cannot say/)
  } finally {
    await site.close()
  }
})

test('an origin with no /api/version at all fails rather than passing quietly', async () => {
  // What an older deployment answers: the route did not exist before this work.
  const site = await serving([{ status: 404, body: '' }])
  try {
    const verdict = await askUntil(site.origin, MERGED, noWait)
    assert.equal(verdict.ok, false)
    assert.match(verdict.message, /404/)
  } finally {
    await site.close()
  }
})

test('an unreachable origin fails rather than throwing', async () => {
  const site = await serving([{ status: 200, body: { commit: MERGED, source: 'ci' } }])
  const origin = site.origin
  await site.close()
  const verdict = await askUntil(origin, MERGED, noWait)
  assert.equal(verdict.ok, false)
  assert.match(verdict.message, /could not reach/)
})

test('a body that is not JSON fails rather than throwing', async () => {
  const site = await serving([
    { status: 200, body: '<html>a cache put something else here</html>' },
  ])
  try {
    const verdict = await askUntil(site.origin, MERGED, noWait)
    assert.equal(verdict.ok, false)
  } finally {
    await site.close()
  }
})

test('an abbreviated sha is not accepted as a match', () => {
  const verdict = readAnswer(MERGED, {
    status: 200,
    body: { commit: MERGED.slice(0, 7), source: 'ci' },
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.retry, false)
})

test('main() refuses an expected value that is not a full sha', async () => {
  const said = []
  const code = await main(['https://example.test', 'main'], {
    log: (line) => said.push(line),
    error: (line) => said.push(line),
  })
  assert.equal(code, 2)
})

test('main() refuses to run with no arguments', async () => {
  const code = await main([], { log: () => {}, error: () => {} })
  assert.equal(code, 2)
})

/**
 * The second incident, on 2026-08-25. `vercel pull` will not hand back the
 * value of an environment variable the project marks sensitive: it writes the
 * literal placeholder `[SENSITIVE]` instead. NEXT_PUBLIC_SITE_URL is one of
 * those, so the publish job read that placeholder, found it non-empty, and
 * handed it here as an origin. `new URL('/api/version', '[SENSITIVE]')` threw
 * out of the middle of the run and the step died on a stack trace naming
 * neither the cause nor the check that was skipped.
 *
 * The placeholder is Vercel's own text, not a redaction. GitHub masks with
 * `***`, which is what VERCEL_TOKEN looked like two lines above it in the same
 * log.
 */
test('the second incident: an origin that is not a URL is named, not thrown', async () => {
  const said = []
  const code = await main(['[SENSITIVE]', MERGED], {
    log: () => {},
    error: (line) => said.push(line),
    ...noWait,
  })
  assert.equal(code, 2)
  const all = said.join('\n')
  assert.match(all, /\[SENSITIVE\]/)
  assert.match(all, /not an absolute http\(s\) address/i)
})

test('an origin that is only whitespace is refused with the same named cause', async () => {
  const said = []
  const code = await main(['   ', MERGED], {
    log: () => {},
    error: (line) => said.push(line),
    ...noWait,
  })
  assert.equal(code, 2)
  assert.match(said.join('\n'), /no address/i)
})

test('an origin with a host but no scheme is refused rather than guessed at', async () => {
  const said = []
  const code = await main(['mirthly.app', MERGED], {
    log: () => {},
    error: (line) => said.push(line),
    ...noWait,
  })
  assert.equal(code, 2)
  assert.match(said.join('\n'), /not an absolute http\(s\) address/i)
})
