import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classify,
  describeToken,
  main,
  probes,
  readable,
  redact,
  runProbe,
} from './vercel-scope.mjs'

const ORG = 'team_EXAMPLEORGID'
const PROJECT = 'prj_EXAMPLEPROJECTID'
const TOKEN = 'a-secret-that-must-never-be-printed'

const yes = { ok: true, status: 0, stdout: '', stderr: '' }
const no = (stderr) => ({ ok: false, status: 1, stdout: '', stderr })

/**
 * The whole point of this script is that the four possible meanings of one
 * sentence become four different sentences, so each one is asserted by name
 * rather than by "it failed".
 */
test('an unusable token is named as an unusable token', () => {
  const verdict = classify({
    orgId: ORG,
    projectId: PROJECT,
    answers: { identity: no('Error: Not authorized') },
  })
  assert.equal(verdict.cause, 'token-not-accepted')
  assert.match(verdict.headline, /not a credential Vercel accepts/)
})

test('a token that cannot reach the scope is named as a scope problem, not a linking one', () => {
  const verdict = classify({
    orgId: ORG,
    projectId: PROJECT,
    answers: { identity: yes, scope: no('Error: The specified scope does not exist') },
  })
  assert.equal(verdict.cause, 'scope-not-reachable')
  assert.match(verdict.headline, new RegExp(ORG))
  // The advice the generic message gives is the advice that cannot apply in CI.
  assert.doesNotMatch(verdict.fix, /\.vercel/)
})

test('a project that does not resolve inside a reachable scope is named as a project id problem', () => {
  const verdict = classify({
    orgId: ORG,
    projectId: PROJECT,
    answers: { identity: yes, scope: yes, project: no('Error: Project not found') },
  })
  assert.equal(verdict.cause, 'project-not-in-scope')
  assert.match(verdict.headline, new RegExp(PROJECT))
  assert.match(verdict.fix, /VERCEL_PROJECT_ID/)
})

test('all three answers yes is reported as "not the cause", not as "everything is fine"', () => {
  const verdict = classify({
    orgId: ORG,
    projectId: PROJECT,
    answers: { identity: yes, scope: yes, project: yes },
  })
  assert.equal(verdict.cause, 'none')
  assert.match(verdict.meaning, /not the cause/)
})

test('the first failure is the cause, and later answers cannot overrule it', () => {
  const verdict = classify({
    orgId: ORG,
    projectId: PROJECT,
    answers: { identity: no('nope'), scope: yes, project: yes },
  })
  assert.equal(verdict.cause, 'token-not-accepted')
})

test('redact removes whole occurrences of the token and nothing less', () => {
  assert.equal(redact(`used ${TOKEN} here`, TOKEN), 'used [redacted] here')
  // No prefix survives: a fragment is not an acceptable amount of a secret.
  assert.doesNotMatch(redact(`${TOKEN}${TOKEN}`, TOKEN), new RegExp(TOKEN.slice(0, 8)))
})

test('describeToken says length and whitespace and never any of the value', () => {
  const described = describeToken(` ${TOKEN}\n`)
  assert.match(described, /surrounding whitespace/)
  assert.doesNotMatch(described, new RegExp(TOKEN.slice(0, 6)))
  assert.match(describeToken(TOKEN), new RegExp(`${TOKEN.length} characters`))
})

test('readable redacts both streams and caps a noisy answer', () => {
  const answer = { ok: false, status: 1, stdout: `a ${TOKEN}`, stderr: 'b\n\nc' }
  assert.deepEqual(readable(answer, TOKEN), ['a [redacted]', 'b', 'c'])
  const noisy = {
    ok: false,
    status: 1,
    stdout: Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'),
    stderr: '',
  }
  const capped = readable(noisy, TOKEN, 10)
  assert.equal(capped.length, 11)
  assert.match(capped.at(-1), /40 more line\(s\)/)
})

test('the token reaches the CLI through the environment and never through argv', () => {
  const seen = []
  for (const probe of probes({ orgId: ORG, projectId: PROJECT })) {
    runProbe(probe, {
      token: TOKEN,
      run: (args, env) => {
        seen.push({ args, env })
        return yes
      },
    })
  }
  assert.equal(seen.length, 3)
  for (const { args, env } of seen) {
    assert.equal(args.join(' ').includes(TOKEN), false)
    assert.equal(args.includes('--token'), false)
    assert.equal(env.VERCEL_TOKEN, TOKEN)
    // The identity and scope questions must not be answerable by the ids.
    assert.equal('VERCEL_ORG_ID' in env, false)
    assert.equal('VERCEL_PROJECT_ID' in env, false)
  }
})

test('the scope question is asked with the org id and the project question with both', () => {
  const [identity, scope, project] = probes({ orgId: ORG, projectId: PROJECT })
  assert.deepEqual(identity.args, ['whoami'])
  assert.deepEqual(scope.args, ['project', 'list', '--scope', ORG, '--limit', '1'])
  assert.deepEqual(project.args, ['project', 'inspect', PROJECT, '--scope', ORG, '--yes'])
})

test('main stops at the first failed question rather than asking meaningless ones', async () => {
  const asked = []
  const lines = []
  const code = await main([], {
    env: { VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: ORG, VERCEL_PROJECT_ID: PROJECT },
    log: (line) => lines.push(String(line)),
    error: (line) => lines.push(String(line)),
    run: (args) => {
      asked.push(args[0])
      return args[0] === 'whoami'
        ? { ok: true, status: 0, stdout: 'someone', stderr: '' }
        : no('Error: The specified scope does not exist')
    },
  })
  assert.equal(code, 1)
  assert.deepEqual(asked, ['whoami', 'project'])
  const printed = lines.join('\n')
  assert.match(printed, /::error::.*cannot reach the scope/)
  assert.match(printed, /The specified scope does not exist/)
  assert.equal(printed.includes(TOKEN), false)
})

test('main exits 0, loudly, when the credential is not the problem', async () => {
  const lines = []
  const code = await main([], {
    env: { VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: ORG, VERCEL_PROJECT_ID: PROJECT },
    log: (line) => lines.push(String(line)),
    error: (line) => lines.push(String(line)),
    run: () => ({ ok: true, status: 0, stdout: 'fine', stderr: '' }),
  })
  assert.equal(code, 0)
  assert.match(lines.join('\n'), /not the cause/)
})

test('main refuses rather than guessing when it is run without the three inputs', async () => {
  const lines = []
  const code = await main([], {
    env: { VERCEL_TOKEN: TOKEN },
    log: (line) => lines.push(String(line)),
    error: (line) => lines.push(String(line)),
    run: () => {
      throw new Error('must not ask Vercel anything')
    },
  })
  assert.equal(code, 2)
  assert.match(lines.join('\n'), /::error::/)
})

test('no output path prints the token, whatever the CLI says back', async () => {
  const lines = []
  await main([], {
    env: { VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: ORG, VERCEL_PROJECT_ID: PROJECT },
    log: (line) => lines.push(String(line)),
    error: (line) => lines.push(String(line)),
    // A CLI that echoes the credential straight back at us.
    run: () => ({
      ok: false,
      status: 1,
      stdout: `token was ${TOKEN}`,
      stderr: `bad token: ${TOKEN}`,
    }),
  })
  const printed = lines.join('\n')
  assert.equal(printed.includes(TOKEN), false)
  assert.match(printed, /\[redacted\]/)
})
