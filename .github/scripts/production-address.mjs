#!/usr/bin/env node
/**
 * Asks Vercel which addresses this project is served at in production, so the
 * check that proves a publish worked has something real to ask.
 *
 * Why this is not read from NEXT_PUBLIC_SITE_URL any more.
 *
 * It used to be. The publish job ran `vercel pull`, grepped
 * `.vercel/.env.production.local` for NEXT_PUBLIC_SITE_URL, and handed what it
 * found to deployed-commit.mjs. On 2026-08-25, the first run where publishing
 * actually worked end to end, that step reported success and produced this:
 *
 *   NEXT_PUBLIC_SITE_URL="[SENSITIVE]"
 *
 * `[SENSITIVE]` is Vercel's own placeholder, written verbatim into the file.
 * Every environment variable on this project is stored with `type: "sensitive"`,
 * which means write-only: the API returns the name and never the value, so
 * `vercel pull` and `vercel env pull` both write the placeholder. It is not a
 * redaction. GitHub masks with `***`, which is what VERCEL_TOKEN looked like in
 * the same log two lines above.
 *
 * The old step only asked whether the value was empty. A placeholder is not
 * empty, so it passed, and the step after it died inside `new URL` with a stack
 * trace. The only check on whether the site is live could not run, and it took
 * a person reading the log to notice.
 *
 * Making the variable readable is the wrong fix: sensitive is the right setting
 * for SUPABASE_SERVICE_ROLE_KEY sitting beside it, and the publish check should
 * not need a secret to find out where a public website is. So the address comes
 * from Vercel's own answer about the project instead, which is the thing that
 * actually decides where a guest lands.
 *
 * What Vercel returns, and why picking one takes rules
 * ----------------------------------------------------
 * `GET /v9/projects/<id>/domains?production=true` returns several records with
 * different shapes. On this project, three:
 *
 *   { name: 'www.mirthly.app',  redirect: 'mirthly.app', redirectStatusCode: 308 }
 *   { name: 'mirthly.app',      redirect: null,  apexName: 'mirthly.app' }
 *   { name: 'the-project.vercel.app', redirect: null, apexName: 'vercel.app' }
 *
 * A `redirect` record is a signpost and not an address: checking it would prove
 * that a 308 works. A record with a `gitBranch` or a `customEnvironmentId` is
 * some other environment wearing a production flag. What is left is the set of
 * addresses a guest can be handed, and when a custom domain is among them, that
 * is the one on the invitation; the `*.vercel.app` name is the fallback for a
 * project that has no domain of its own yet.
 *
 * Every address in the chosen tier is checked, not the first one, because a
 * project with two live domains has two addresses that must both serve the
 * merged commit.
 *
 * It never prints the token. Writes `origins` to GITHUB_OUTPUT as a
 * space-separated list, and fails loudly rather than emitting an empty one.
 *
 * Usage: node .github/scripts/production-address.mjs
 * Reads VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID from the environment.
 *
 * Its logic is tested in production-address.test.mjs, run by the `static` job.
 */

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Vercel's own name for the domains it hands out when a project has none of its own. */
export const VERCEL_APEX = 'vercel.app'

/** Says, for one domain record, whether a guest could be served the site at it. */
export function classify(domain) {
  if (typeof domain?.name !== 'string' || domain.name === '') {
    return { usable: false, why: 'has no name' }
  }
  if (domain.redirect !== null && domain.redirect !== undefined) {
    return {
      usable: false,
      why: `redirects to ${domain.redirect}, so it is a signpost and not the address`,
    }
  }
  if (domain.gitBranch !== null && domain.gitBranch !== undefined) {
    return {
      usable: false,
      why: `is pinned to the branch ${domain.gitBranch}, so it is not production`,
    }
  }
  if (domain.customEnvironmentId !== null && domain.customEnvironmentId !== undefined) {
    return { usable: false, why: 'belongs to a custom environment, so it is not production' }
  }
  if (domain.verified === false) {
    return { usable: false, why: 'is not verified, so Vercel is not serving it' }
  }
  return { usable: true, why: 'is served in production' }
}

/**
 * Turns the whole answer into the addresses to check, or into a named refusal.
 *
 * Refusing is the important half. An empty list must never reach the caller as
 * "nothing to check": that is the shape that made a broken publish look green.
 */
export function chooseAddresses(domains) {
  const seen = Array.isArray(domains) ? domains : []
  const considered = seen.map((domain) => ({ name: domain?.name, ...classify(domain) }))
  const usable = considered.filter((entry) => entry.usable)

  if (usable.length === 0) {
    return {
      ok: false,
      considered,
      reason:
        seen.length === 0
          ? 'Vercel lists no production domain for this project at all. Nothing is serving it, so there is no address at which a publish could be proved.'
          : 'Vercel lists production domains for this project, but none of them is an address a guest is served at. Every one is listed above with the reason it was not used.',
    }
  }

  const own = usable.filter((entry) => !entry.name.endsWith(`.${VERCEL_APEX}`))
  const chosen = own.length > 0 ? own : usable

  return { ok: true, considered, origins: chosen.map((entry) => `https://${entry.name}`) }
}

/** Asks Vercel. Never throws, and never puts the token anywhere but the header. */
export async function fetchDomains({ token, orgId, projectId, fetchImpl = fetch }) {
  const url =
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/domains` +
    `?teamId=${encodeURIComponent(orgId)}&production=true&limit=100`

  let response
  try {
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    })
  } catch (error) {
    return { ok: false, message: `could not reach the Vercel API: ${error.message}` }
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      message:
        `Vercel answered ${response.status} to the request for this project's production domains. ` +
        'The token is not accepted, or it cannot reach this scope. ' +
        '.github/scripts/vercel-scope.mjs asks that question on its own and names which it is.',
    }
  }

  if (response.status === 404) {
    return {
      ok: false,
      message:
        'Vercel answered 404: VERCEL_PROJECT_ID does not resolve inside VERCEL_ORG_ID. ' +
        'The repository variable is wrong, or the project moved.',
    }
  }

  if (response.status !== 200) {
    return { ok: false, message: `Vercel answered ${response.status} and not a list of domains.` }
  }

  let body
  try {
    body = await response.json()
  } catch {
    return { ok: false, message: 'Vercel answered 200 with something that is not JSON.' }
  }

  if (!Array.isArray(body?.domains)) {
    return { ok: false, message: 'Vercel answered 200 with no `domains` list in it.' }
  }

  return { ok: true, domains: body.domains }
}

export async function main(
  _argv,
  {
    env = process.env,
    log = console.log,
    error = console.error,
    fetchImpl = fetch,
    writeOutput = defaultWriteOutput,
  } = {}
) {
  const token = env.VERCEL_TOKEN
  const orgId = env.VERCEL_ORG_ID
  const projectId = env.VERCEL_PROJECT_ID

  if (!token || !orgId || !projectId) {
    error(
      '::error::production-address needs VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID in the environment.'
    )
    return 2
  }

  log('Asking Vercel which addresses this project is served at in production.')

  const answer = await fetchDomains({ token, orgId, projectId, fetchImpl })
  if (!answer.ok) {
    return refuse(error, answer.message, [])
  }

  const chosen = chooseAddresses(answer.domains)

  log('')
  log('What Vercel says is attached to this project in production:')
  for (const entry of chosen.considered) {
    log(`  ${entry.usable ? 'use ' : 'skip'}  ${entry.name ?? '(unnamed)'} - ${entry.why}`)
  }
  log('')

  if (!chosen.ok) {
    return refuse(error, chosen.reason, chosen.considered)
  }

  for (const origin of chosen.origins) log(`Will check ${origin}`)

  writeOutput(env, `origins=${chosen.origins.join(' ')}`)
  return 0
}

function refuse(error, message, considered) {
  error('')
  error('::error::The live address could not be determined, so the publish was not proved.')
  error('')
  error(message)
  if (considered.length > 0) {
    error('')
    for (const entry of considered) {
      error(`  ${entry.name ?? '(unnamed)'} - ${entry.why}`)
    }
  }
  error('')
  error(
    'This is not "nothing to check". The deployment above may or may not be live and this run cannot tell, ' +
      'which is the state the whole job exists to refuse.'
  )
  error('docs/hosting.md, "Publishing is done by CI", says where the address comes from.')
  return 1
}

function defaultWriteOutput(env, line) {
  if (!env.GITHUB_OUTPUT) return
  appendFileSync(env.GITHUB_OUTPUT, `${line}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)))
}
