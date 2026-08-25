#!/usr/bin/env node
/**
 * Asks Vercel what the publishing credential actually is, and what it can
 * actually see, before anything tries to publish with it.
 *
 * On 2026-08-25 the `publish to production` job failed on its first real
 * command with this, twice:
 *
 *   Error: Could not retrieve Project Settings. To link your Project, remove
 *   the `.vercel` directory and deploy again.
 *
 * That sentence can mean four different things and names none of them. Reading
 * the pinned CLI's own source says where it comes from: `getLinkedProject`
 * resolves the link from VERCEL_ORG_ID and VERCEL_PROJECT_ID, then looks the
 * org and the project up, and prints exactly that sentence when either lookup
 * comes back 403 with code `forbidden` or `team_unauthorized`. A 404 prints
 * something else, an unusable token throws something else again, and the advice
 * about removing `.vercel` cannot apply in CI, where there is no such directory
 * to remove. So the message is a permission answer wearing a linking answer's
 * clothes, and it never says which of the three permission answers it is.
 *
 * This asks the three questions separately, so the failure names itself:
 *
 *   1. Is VERCEL_TOKEN a credential Vercel accepts at all?   `vercel whoami`
 *   2. Can it resolve VERCEL_ORG_ID as a scope?              `vercel project list --scope`
 *   3. Does VERCEL_PROJECT_ID exist inside that scope?       `vercel project inspect --scope`
 *
 * Each question is only asked when the one before it was answered yes, because
 * once a question has failed the later ones cannot mean anything.
 *
 * The token is never printed. It is handed to the CLI through the child
 * process environment rather than on a command line, so it is not in any argv
 * this script logs, and every captured line is passed through `redact()` on the
 * way out in case the CLI ever echoes it back. A length and a "has surrounding
 * whitespace" boolean are reported, because a secret pasted with a trailing
 * newline is a real and otherwise invisible failure, and neither is a fragment
 * of the value.
 *
 * Usage: node .github/scripts/vercel-scope.mjs
 * Reads VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID from the environment.
 *
 * Its logic is tested in vercel-scope.test.mjs, run by the `static` job.
 */

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * Removes the token from anything on its way to the log.
 *
 * Whole occurrences only. A redactor that also blanked prefixes would be
 * printing where the value starts, and a redactor that printed "first four
 * characters match" would be publishing four characters of a secret.
 */
export function redact(text, token) {
  if (typeof text !== 'string') return ''
  if (!token) return text
  return text.split(token).join('[redacted]')
}

/** What can be said about the token without saying any of it. */
export function describeToken(token) {
  if (!token) return 'VERCEL_TOKEN: not set'
  const trimmed = token.trim()
  const whitespace = trimmed.length !== token.length
  return [
    `VERCEL_TOKEN: present, ${token.length} characters`,
    whitespace
      ? `, and it has surrounding whitespace (${token.length - trimmed.length} character(s)), which is almost always a paste accident`
      : ', no surrounding whitespace',
  ].join('')
}

/**
 * The three questions, in the order in which asking them makes sense.
 *
 * `--scope` takes a team id as happily as a slug: the CLI matches the flag
 * against both `team.id` and `team.slug` before it gives up, so the repository
 * variable can be used as it stands with no slug written into this file.
 */
export function probes({ orgId, projectId }) {
  return [
    {
      key: 'identity',
      question: 'Is this token a credential Vercel accepts at all?',
      args: ['whoami'],
    },
    {
      key: 'scope',
      question: `Can this token resolve ${orgId} as a scope?`,
      args: ['project', 'list', '--scope', orgId, '--limit', '1'],
    },
    {
      key: 'project',
      question: `Does ${projectId} exist inside that scope?`,
      args: ['project', 'inspect', projectId, '--scope', orgId, '--yes'],
    },
  ]
}

/**
 * Says what kind of "no" the identity question got, in the CLI's own words.
 *
 * The distinction is worth drawing because the two answers need different
 * things done about them, and because "invalid token" is the wrong sentence for
 * a token that authenticated fine and simply has no user behind it.
 */
export function readIdentityRefusal(text) {
  if (/user not found|missing from response/i.test(text)) {
    return (
      'Vercel answered the identity request rather than refusing it, and said there is no user. ' +
      'The value in the secret is not a Vercel personal access token, or the account behind it no ' +
      'longer exists. A token created at vercel.com/account/settings/tokens answers this question ' +
      'with a username.'
    )
  }
  if (/not valid|not authorized|invalid token|expired/i.test(text)) {
    return 'Vercel refused the token outright: it is invalid, malformed, revoked or expired.'
  }
  return "The CLI's own words are above; they are the evidence."
}

/**
 * Turns the answers into a named cause.
 *
 * The three causes are the three questions above, in order, and the first
 * unanswered one is the cause. `none` is honest rather than reassuring: it
 * means this script could not reproduce the failure, and whatever runs next
 * gets to speak for itself.
 */
export function classify({ orgId, projectId, answers }) {
  const identity = answers.identity
  const scope = answers.scope
  const project = answers.project

  if (identity && !identity.ok) {
    const refusal = readIdentityRefusal(`${identity.stdout}\n${identity.stderr}`)
    return {
      cause: 'token-not-accepted',
      headline: 'VERCEL_TOKEN is not a credential this CLI can use.',
      meaning:
        '`vercel whoami` could not say who this token is, which happens before any scope or ' +
        `project is looked at. ${refusal}`,
      fix: 'Create a personal access token at https://vercel.com/account/settings/tokens, under the scope that owns the project, and replace the VERCEL_TOKEN repository secret with it.',
      whose: 'the captain',
    }
  }

  if (scope && !scope.ok) {
    return {
      cause: 'scope-not-reachable',
      headline: `The token is accepted, but it cannot reach the scope ${orgId}.`,
      meaning:
        'Vercel knows this token and told us who it is, and then refused to resolve ' +
        `VERCEL_ORG_ID (${orgId}). The token belongs to a scope that does not contain this project. ` +
        'This is what `Could not retrieve Project Settings` was hiding: a 403 on the owner lookup, ' +
        'not a missing `.vercel` directory.',
      fix:
        'Create the token under the scope that owns the project, or add the token owner to that team, ' +
        'and replace the VERCEL_TOKEN repository secret. The identity printed above is the one the ' +
        'current token has; it needs to be one that lists this scope.',
      whose: 'the captain',
    }
  }

  if (project && !project.ok) {
    return {
      cause: 'project-not-in-scope',
      headline: `The token and the scope are both fine, but ${projectId} does not resolve inside ${orgId}.`,
      meaning:
        'The project id is wrong, the project was deleted, or it was transferred to another team.',
      fix: `Run \`vercel project ls --scope ${orgId}\` to find the real id and update the VERCEL_PROJECT_ID repository variable.`,
      whose: 'whoever changes repository variables',
    }
  }

  return {
    cause: 'none',
    headline: 'The token is accepted, the scope resolves, and the project resolves inside it.',
    meaning:
      'This check found nothing wrong with the credential, so it is not the cause. ' +
      'If the publish still fails, the failure is downstream of this and its own message is the evidence.',
    fix: '',
    whose: '',
  }
}

/**
 * Runs one probe. Never throws: a CLI that could not be spawned is just another
 * failed answer.
 *
 * VERCEL_ORG_ID and VERCEL_PROJECT_ID are taken out of the child environment
 * for every probe. The CLI reads them as an implicit link, so leaving them in
 * would let a scope problem answer the identity question and would make the
 * scope question ask about the link rather than about the flag. Each probe
 * names what it wants on the command line instead, so the answer it gets is
 * about the thing it asked.
 */
export function runProbe(probe, { token, run = defaultRun }) {
  const env = { ...process.env, VERCEL_TOKEN: token, VERCEL_TELEMETRY_DISABLED: '1' }
  delete env.VERCEL_ORG_ID
  delete env.VERCEL_PROJECT_ID
  return run(probe.args, env)
}

function defaultRun(args, env) {
  const result = spawnSync('vercel', args, { env, encoding: 'utf8' })
  if (result.error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: `could not run the Vercel CLI: ${result.error.message}`,
    }
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

export async function main(
  _argv,
  { env = process.env, log = console.log, error = console.error, run = defaultRun } = {}
) {
  const token = env.VERCEL_TOKEN
  const orgId = env.VERCEL_ORG_ID
  const projectId = env.VERCEL_PROJECT_ID

  if (!token || !orgId || !projectId) {
    // The job's own preflight already refuses this, so reaching it here means
    // the script was run somewhere else. Say so rather than reporting a cause
    // that was never tested.
    error(
      '::error::vercel-scope needs VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID in the environment.'
    )
    return 2
  }

  log('Asking Vercel what this token is and what it can see, before anything publishes with it.')
  log(describeToken(token))
  log(`VERCEL_ORG_ID: ${orgId}`)
  log(`VERCEL_PROJECT_ID: ${projectId}`)
  log('')

  const answers = {}
  for (const probe of probes({ orgId, projectId })) {
    log(`## ${probe.question}`)
    log(`   $ vercel ${probe.args.join(' ')}`)
    const answer = runProbe(probe, { token, run })
    answers[probe.key] = answer

    // Both streams, always, and never swallowed. A diagnostic that hides the
    // tool's own words is worse than no diagnostic.
    for (const line of readable(answer, token)) log(`   ${line}`)
    log(answer.ok ? '   -> yes' : `   -> no (exit ${answer.status})`)
    log('')

    if (!answer.ok) break
  }

  const verdict = classify({ orgId, projectId, answers })

  if (verdict.cause === 'none') {
    log(verdict.headline)
    log(verdict.meaning)
    return 0
  }

  error('')
  error(`::error::${verdict.headline}`)
  error('')
  error(verdict.meaning)
  error('')
  error(`What fixes it: ${verdict.fix}`)
  error(`Who can: ${verdict.whose}.`)
  error('')
  error(
    'docs/hosting.md, "Publishing is done by CI", lists the three credentials and what each one is for.'
  )
  return 1
}

/** The CLI's own output, redacted, trimmed of blank lines, and capped so one noisy answer cannot bury the verdict. */
export function readable(answer, token, limit = 40) {
  const lines = [redact(answer.stdout, token), redact(answer.stderr, token)]
    .join('\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  if (lines.length <= limit) return lines
  return [...lines.slice(0, limit), `... ${lines.length - limit} more line(s)`]
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)))
}
