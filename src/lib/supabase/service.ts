import 'server-only'

/**
 * The service role database client. Server only, and strict about its config.
 *
 * `src/lib/env.ts` reads optional config and never throws, because a build with
 * no variables present has to succeed. It also says where the strict checks
 * belong: "When a real service is wired up later, the strict checks belong in
 * that service's own module, not here." This is that module, and it throws.
 *
 * Three decisions worth stating, because each one has a cheaper alternative
 * that is wrong here.
 *
 * It talks to PostgREST over `fetch` rather than through `@supabase/supabase-js`.
 * The guest page's cache lifetime is a deliverable of this stage and a privacy
 * control (docs/serving.md), and the only way to be exact about it is to own the
 * `fetch` call Next instruments: a request that opts out of the data cache turns
 * the whole route dynamic and takes the edge cache with it. A client library
 * that makes its own requests decides that for us. `scripts/check-anon-access.mjs`
 * already talks to PostgREST this way, so it is also the shape this repo reads.
 *
 * It throws on first use, not at import. A module level throw fails
 * `npm run build` on a machine with no credentials, and that build is exactly
 * what CI runs today. The check has to be loud when a request needs it and
 * silent when nothing does.
 *
 * `import 'server-only'` is the enforcement, not a comment. It resolves to a
 * module that throws when it is pulled into a client bundle, so importing this
 * file from a component that says `'use client'` fails the build rather than
 * shipping a service role key to a browser.
 */

export type ServiceConfig = {
  /** Origin of the Supabase API, no trailing slash. */
  readonly url: string
  readonly serviceRoleKey: string
}

/** The variables this module needs, and the only names it reads. */
export const SERVICE_ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

/**
 * Reads the service config, or throws naming every variable that is missing.
 *
 * It reports all of them at once rather than the first one. Someone setting up
 * a new environment should learn the whole list from one failure instead of
 * from three deploys.
 */
export function readServiceConfig(
  source: Record<string, string | undefined> = process.env
): ServiceConfig {
  const missing = SERVICE_ENV_KEYS.filter((key) => (source[key] ?? '').trim() === '')

  if (missing.length > 0) {
    throw new Error(
      `the database client needs ${missing.join(' and ')}. ` +
        'Set them in the environment for this deployment. Locally, `supabase status` prints ' +
        'both for the CLI stack, and they belong in .env.local, which is git ignored. ' +
        'See .env.example.'
    )
  }

  const raw = (source.SUPABASE_URL ?? '').trim()
  let origin: string
  try {
    origin = new URL(raw).origin
  } catch {
    throw new Error(
      `SUPABASE_URL must be an absolute URL such as http://127.0.0.1:54321, got "${raw}"`
    )
  }

  return { url: origin, serviceRoleKey: (source.SUPABASE_SERVICE_ROLE_KEY ?? '').trim() }
}

export type ServiceResponse = {
  readonly ok: boolean
  readonly status: number
  /** Parsed body when the response was JSON, null otherwise. */
  readonly json: unknown
  /** First 400 characters of the body, for a message a human can act on. */
  readonly detail: string
}

export type ServiceRequestOptions = {
  /**
   * Seconds Next may serve this response from its data cache, or `false` for a
   * read that must see the database as it is right now.
   *
   * It is required rather than defaulted. Next's default is no-store, which
   * makes the calling route dynamic, and a dynamic guest page gives up the edge
   * cache entirely (report section 6.2). Making the caller say a number means
   * nobody gets that by accident.
   *
   * `false` is for the write path and nothing else. A guest page may be up to a
   * minute out of date about whether replies are open, which is a bound this
   * repo chose deliberately; a request that is about to store somebody's
   * personal information may not be out of date about it at all.
   */
  readonly revalidate: number | false
  /** Cache tags, so a publish path can invalidate one event rather than a path. */
  readonly tags?: readonly string[]
}

/**
 * One PostgREST GET, with the service role.
 *
 * Never throws on a response, only on a config problem or a dead connection.
 * This runs while a guest is looking at a page, so a database that is down has
 * to become a designed state upstream rather than a stack trace.
 */
export async function serviceGet(
  path: string,
  options: ServiceRequestOptions
): Promise<ServiceResponse> {
  const config = readServiceConfig()

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: 'application/json',
    },
    ...(options.revalidate === false
      ? { cache: 'no-store' as const }
      : {
          next: {
            revalidate: options.revalidate,
            ...(options.tags === undefined ? {} : { tags: [...options.tags] }),
          },
        }),
  })

  return read(response)
}

/**
 * One PostgREST POST, with the service role. Never cached, at either layer.
 *
 * Writes and reads are separated here rather than folded into one function with
 * a method argument, because the only interesting thing they share is the
 * headers and the two have opposite rules about caching. A write that inherited
 * `revalidate` from a caller in a hurry would be a reply nobody stored.
 *
 * Like `serviceGet`, it throws only on a config problem or a dead connection.
 * PostgREST's own refusals come back as a response, because the route above
 * turns some of them into designed answers: a slug that stopped being live
 * between the page rendering and the guest pressing send is a message about the
 * invitation, not a 500.
 */
export async function servicePost(
  path: string,
  body: unknown,
  options: { readonly prefer?: string } = {}
): Promise<ServiceResponse> {
  return serviceWrite('POST', path, body, options)
}

/**
 * One PostgREST PATCH, with the service role. Never cached, at either layer.
 *
 * It exists for one shape and it is worth naming: the compare and set that
 * spends an activation code. `activation_codes?id=eq.<id>&status=eq.issued` with
 * `Prefer: return=representation` comes back with one row for the request that
 * won and an empty array for every other one, because Postgres re-checks the
 * filter after it takes the row lock. That empty array is the whole of the
 * concurrency argument in `src/lib/activation/claim.ts`.
 */
export async function servicePatch(
  path: string,
  body: unknown,
  options: { readonly prefer?: string } = {}
): Promise<ServiceResponse> {
  return serviceWrite('PATCH', path, body, options)
}

/**
 * One PostgREST DELETE, with the service role.
 *
 * The claim path uses it to take back an event it created and then could not
 * pay for with the code, which is the only delete in this application. See
 * `src/lib/activation/claim.ts`.
 */
export async function serviceDelete(
  path: string,
  options: { readonly prefer?: string } = {}
): Promise<ServiceResponse> {
  return serviceWrite('DELETE', path, undefined, options)
}

async function serviceWrite(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  options: { readonly prefer?: string }
): Promise<ServiceResponse> {
  const config = readServiceConfig()

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.prefer === undefined ? {} : { Prefer: options.prefer }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })

  return read(response)
}

async function read(response: Response): Promise<ServiceResponse> {
  const text = await response.text()
  let json: unknown = null
  try {
    json = text === '' ? null : JSON.parse(text)
  } catch {
    /* not JSON: detail carries the text instead */
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    detail: text.slice(0, 400),
  }
}
