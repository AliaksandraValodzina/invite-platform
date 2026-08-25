/**
 * Tests for the step that decides which address a publish is proved against.
 *
 * Run by the `static` job: `node --test .github/scripts/production-address.test.mjs`.
 * No dependencies, so it does not care whether `npm ci` has run.
 *
 * REAL is the answer Vercel actually gave for this project on 2026-08-26,
 * copied field for field. Three records, three different shapes, and only one
 * of them is the address on the invitation. A test written against a tidied up
 * version of that answer would be a test about the tidying.
 *
 * The one thing changed from the real answer is the name of the third record:
 * the address Vercel assigns a project is a deployment detail nobody published,
 * and only its `apexName` matters to the code. Every field the logic reads is
 * as Vercel sent it.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { chooseAddresses, classify, fetchDomains, main } from './production-address.mjs'

const REAL = [
  {
    name: 'www.mirthly.app',
    apexName: 'mirthly.app',
    redirect: 'mirthly.app',
    redirectStatusCode: 308,
    gitBranch: null,
    customEnvironmentId: null,
    verified: true,
  },
  {
    name: 'mirthly.app',
    apexName: 'mirthly.app',
    redirect: null,
    redirectStatusCode: null,
    gitBranch: null,
    customEnvironmentId: null,
    verified: true,
  },
  {
    name: 'the-project.vercel.app',
    apexName: 'vercel.app',
    redirect: null,
    gitBranch: null,
    customEnvironmentId: null,
    verified: true,
  },
]

const ENV = {
  VERCEL_TOKEN: 'not-a-real-token',
  VERCEL_ORG_ID: 'team_test',
  VERCEL_PROJECT_ID: 'prj_test',
}

/** A fetch that answers the domains endpoint with whatever it is handed. */
function answering({ status = 200, body = { domains: REAL }, json = true } = {}) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return {
      status,
      json: async () => {
        if (!json) throw new SyntaxError('not JSON')
        return body
      },
    }
  }
  return { impl, calls }
}

test('the real answer: the custom domain is chosen and the 308 signpost is not', () => {
  const chosen = chooseAddresses(REAL)
  assert.equal(chosen.ok, true)
  assert.deepEqual(chosen.origins, ['https://mirthly.app'])
})

test('the www record is skipped for being a redirect, and says so', () => {
  const verdict = classify(REAL[0])
  assert.equal(verdict.usable, false)
  assert.match(verdict.why, /redirects to mirthly\.app/)
})

test('a project with no domain of its own falls back to the one Vercel gave it', () => {
  const chosen = chooseAddresses([REAL[2]])
  assert.equal(chosen.ok, true)
  assert.deepEqual(chosen.origins, ['https://the-project.vercel.app'])
})

test('two live domains are both checked, because both are addresses a guest is handed', () => {
  const second = { ...REAL[1], name: 'mirthly.example', apexName: 'mirthly.example' }
  const chosen = chooseAddresses([...REAL, second])
  assert.deepEqual(chosen.origins, ['https://mirthly.app', 'https://mirthly.example'])
})

test('a branch-pinned domain is not mistaken for production', () => {
  const branch = { ...REAL[1], name: 'staging.mirthly.app', gitBranch: 'staging' }
  const chosen = chooseAddresses([branch])
  assert.equal(chosen.ok, false)
  assert.match(chosen.considered[0].why, /staging/)
})

test('an unverified domain is not checked, because Vercel is not serving it', () => {
  const chosen = chooseAddresses([{ ...REAL[1], verified: false }])
  assert.equal(chosen.ok, false)
  assert.match(chosen.considered[0].why, /not verified/)
})

test('no domains at all is a refusal and never an empty list of things to check', () => {
  const chosen = chooseAddresses([])
  assert.equal(chosen.ok, false)
  assert.equal(chosen.origins, undefined)
  assert.match(chosen.reason, /no production domain/i)
})

test('only redirects is a refusal too: proving a 308 works proves nothing about the site', () => {
  const chosen = chooseAddresses([REAL[0]])
  assert.equal(chosen.ok, false)
  assert.equal(chosen.origins, undefined)
})

test('main() writes one output line naming every address it will check', async () => {
  const written = []
  const { impl, calls } = answering()
  const code = await main([], {
    env: ENV,
    log: () => {},
    error: () => {},
    fetchImpl: impl,
    writeOutput: (_env, line) => written.push(line),
  })
  assert.equal(code, 0)
  assert.deepEqual(written, ['origins=https://mirthly.app'])
  assert.match(calls[0].url, /production=true/)
  assert.equal(calls[0].init.headers.authorization, 'Bearer not-a-real-token')
})

test('main() writes no output at all when it cannot determine an address', async () => {
  const written = []
  const { impl } = answering({ body: { domains: [] } })
  const code = await main([], {
    env: ENV,
    log: () => {},
    error: () => {},
    fetchImpl: impl,
    writeOutput: (_env, line) => written.push(line),
  })
  assert.equal(code, 1)
  assert.deepEqual(written, [])
})

test('a 403 names the credential rather than the domains', async () => {
  const said = []
  const { impl } = answering({ status: 403 })
  const code = await main([], {
    env: ENV,
    log: () => {},
    error: (line) => said.push(line),
    fetchImpl: impl,
    writeOutput: () => {},
  })
  assert.equal(code, 1)
  assert.match(said.join('\n'), /vercel-scope/)
})

test('a 404 names VERCEL_PROJECT_ID', async () => {
  const answer = await fetchDomains({
    token: 't',
    orgId: 'o',
    projectId: 'p',
    fetchImpl: answering({ status: 404 }).impl,
  })
  assert.equal(answer.ok, false)
  assert.match(answer.message, /VERCEL_PROJECT_ID/)
})

test('a 200 that is not JSON is a refusal and not a crash', async () => {
  const answer = await fetchDomains({
    token: 't',
    orgId: 'o',
    projectId: 'p',
    fetchImpl: answering({ json: false }).impl,
  })
  assert.equal(answer.ok, false)
  assert.match(answer.message, /not JSON/)
})

test('the token is never in the URL, only in the header', async () => {
  const { impl, calls } = answering()
  await fetchDomains({ token: 'secret-value', orgId: 'o', projectId: 'p', fetchImpl: impl })
  assert.equal(calls[0].url.includes('secret-value'), false)
})

test('main() refuses when it was given no credentials, rather than reporting no domains', async () => {
  const said = []
  const code = await main([], {
    env: {},
    log: () => {},
    error: (line) => said.push(line),
    fetchImpl: async () => {
      throw new Error('should not have been called')
    },
    writeOutput: () => {},
  })
  assert.equal(code, 2)
  assert.match(said.join('\n'), /VERCEL_TOKEN/)
})
